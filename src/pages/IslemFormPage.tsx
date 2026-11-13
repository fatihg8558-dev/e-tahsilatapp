import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { supabase, handleSupabaseError } from '../lib/supabase';
import { Cari, IslemTip, IslemTur, Islem } from '../types/database';
import { formatCurrency, formatDate } from '../lib/formatters';
import { getExchangeRates, ExchangeRates } from '../lib/currencyService';
import { getPosConfig, generatePaymentLink, PosConfig, PaymentLinkResult } from '../lib/posService';
import {
  ArrowDownLeft,
  ArrowUpRight,
  Banknote,
  CreditCard,
  FileCheck,
  FileText,
  Calendar,
  Building,
  AlertCircle,
  CheckCircle2,
  Search,
  X,
  Repeat,
  Layers,
  DollarSign,
  TrendingUp,
  ArrowRightLeft,
  Share2,
  Copy,
  ExternalLink,
  Plus,
  Trash2,
  Pencil,
} from 'lucide-react';
import { openWhatsApp } from '../lib/linkHelper';
import { KarmaPaymentSection } from '../components/islem/KarmaPaymentSection';
import {
  CekRowItem as KarmaCekRowItem,
  KarmaNakitState,
  KarmaKartState,
  KarmaSaveMode,
  KARMA_REF_REGEX,
  buildKarmaKalemLine,
  buildKarmaLinesFromSiblingIslemler,
  createEmptyCekRow as createEmptyKarmaRow,
  extractKarmaRef,
  formatTrAmount,
  getCurrencyRate,
  getRowTlEquivalent,
  isKarmaAciklama,
  parseKarmaFromAciklama,
} from '../lib/karmaReceiptHelper';

interface CekRowItem {
  id: string;
  no: string;
  vade: string;
  banka: string;
  durum: 'ciro' | 'keside';
  tutar: string;
  paraBirimi: 'TRY' | 'USD' | 'EUR';
  kur?: string;
}

const parseAmountInput = (raw: string): number => {
  const trimmed = (raw || '').trim();
  if (!trimmed) return 0;
  if (trimmed.includes(',')) {
    const normalized = trimmed.replace(/\./g, '').replace(',', '.');
    const n = parseFloat(normalized);
    return isNaN(n) ? 0 : n;
  }
  if (/^\d{1,3}(\.\d{3})+$/.test(trimmed)) {
    const n = parseFloat(trimmed.replace(/\./g, ''));
    return isNaN(n) ? 0 : n;
  }
  const n = parseFloat(trimmed);
  return isNaN(n) ? 0 : n;
};

const formatIsoToDisplay = (iso?: string | null): string => {
  if (!iso) return '';
  const clean = iso.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(clean)) {
    const [y, m, d] = clean.slice(0, 10).split('-');
    return `${d}.${m}.${y}`;
  }
  return clean;
};

const createEmptyCekRow = (): CekRowItem => ({
  id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
  no: '',
  vade: '',
  banka: '',
  durum: 'keside',
  tutar: '',
  paraBirimi: 'TRY',
  kur: '',
});

const parseInitialEditState = (editingIslem?: Islem | null) => {
  if (!editingIslem) {
    return {
      aciklamaClean: '',
      paraBirimi: 'TRY' as 'TRY' | 'USD' | 'EUR',
      dovizTutari: '',
      dovizKuru: '38,45',
      cekList: [createEmptyCekRow()],
    };
  }

  let rawAciklama = editingIslem.aciklama || '';
  let paraBirimi: 'TRY' | 'USD' | 'EUR' = 'TRY';
  let dovizTutari = '';
  let dovizKuru = '38,45';

  const dovizMatch = rawAciklama.match(/\[DÖVİZ:\s*([\d.,]+)\s*(USD|EUR)\s*\(Kur:\s*([\d.,]+)\s*TL\)\]\s*-?\s*/i);
  if (dovizMatch) {
    dovizTutari = dovizMatch[1];
    paraBirimi = dovizMatch[2].toUpperCase() as 'USD' | 'EUR';
    dovizKuru = dovizMatch[3];
    rawAciklama = rawAciklama.replace(dovizMatch[0], '').trim();
  }

  const parsedCekler: CekRowItem[] = [];
  const nonCekLines: string[] = [];

  if (rawAciklama) {
    const lines = rawAciklama.split('\n').map((l) => l.trim()).filter(Boolean);
    for (const line of lines) {
      const cleanLine = line.replace(/^\[ÇEK SATIRI\]\s*/i, '').trim();
      const cekMatch = cleanLine.match(
        /^(.+?)\s+nl\.\s+(.+?)\s+vd\.\s+(.+?)\s+banka\s+(ciro|keşide|keside)\s+([\d.,]+)\s+(TL|TRY|USD|EUR)$/i
      );
      if (cekMatch) {
        const [, noPart, vadePart, bankaPart, durumPart, tutarPart, currPart] = cekMatch;
        const currUpper = currPart.toUpperCase();
        const mappedCurr: 'TRY' | 'USD' | 'EUR' =
          currUpper === 'USD' ? 'USD' : currUpper === 'EUR' ? 'EUR' : 'TRY';
        parsedCekler.push({
          id: `edit-${parsedCekler.length}-${Date.now()}`,
          no: noPart === 'Belgesiz' ? '' : noPart,
          vade: vadePart === '-' ? '' : vadePart,
          banka: bankaPart === '-' ? '' : bankaPart,
          durum: durumPart.toLowerCase() === 'ciro' ? 'ciro' : 'keside',
          tutar: tutarPart,
          paraBirimi: mappedCurr,
          kur: '',
        });
      } else {
        nonCekLines.push(line);
      }
    }
  }

  const isCekType = editingIslem.tur === 'cek' || editingIslem.tur === 'senet';
  if (isCekType && parsedCekler.length === 0) {
    const isCiroNote = rawAciklama.toUpperCase().includes('CİRO') || rawAciklama.toUpperCase().includes('CIRO');
    parsedCekler.push({
      id: `edit-0-${Date.now()}`,
      no: editingIslem.belge_no || '',
      vade: formatIsoToDisplay(editingIslem.vade),
      banka: editingIslem.banka_adi || '',
      durum: isCiroNote ? 'ciro' : 'keside',
      tutar: Number(editingIslem.tutar).toLocaleString('tr-TR', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }),
      paraBirimi: paraBirimi,
      kur: paraBirimi !== 'TRY' ? dovizKuru : '',
    });
  }

  return {
    aciklamaClean: nonCekLines.join('\n').trim(),
    paraBirimi,
    dovizTutari,
    dovizKuru,
    cekList: parsedCekler.length > 0 ? parsedCekler : [createEmptyCekRow()],
  };
};

interface IslemFormPageProps {
  initialTip: IslemTip;
  preSelectedCariId?: string;
  editingIslem?: Islem | null;
  onSuccess: (savedIslem: Islem) => void;
  onCancel: () => void;
}

export const IslemFormPage: React.FC<IslemFormPageProps> = ({
  initialTip,
  preSelectedCariId,
  editingIslem,
  onSuccess,
  onCancel,
}) => {
  const { firma, profile, periodInfo, refreshProfileAndFirma } = useAuth();
  const isEditing = !!editingIslem;
  const initialParsed = parseInitialEditState(editingIslem);

  const [tip, setTip] = useState<IslemTip>(editingIslem?.tip || initialTip);
  const [tur, setTur] = useState<IslemTur>(editingIslem?.tur || 'nakit');

  // Karma (Çoklu Ödeme Türü) Modu State'leri
  const initialIsKarma = isKarmaAciklama(editingIslem?.aciklama);
  const initialKarmaParsed = parseKarmaFromAciklama(editingIslem?.aciklama);
  const [isKarma, setIsKarma] = useState<boolean>(initialIsKarma);
  const [karmaSaveMode, setKarmaSaveMode] = useState<KarmaSaveMode>(() =>
    initialKarmaParsed.kalemler.length > 0 && !initialKarmaParsed.karmaRef
      ? 'tek_satir'
      : 'ortak_tur_bazli'
  );
  const [karmaNakit, setKarmaNakit] = useState<KarmaNakitState>(() => {
    const nakitLine = initialKarmaParsed.kalemler.find((k) => k.tur === 'nakit');
    return {
      tutar: nakitLine ? nakitLine.tutarTL.toFixed(2).replace('.', ',') : '',
      paraBirimi: 'TRY',
      kur: '',
    };
  });
  const [karmaKart, setKarmaKart] = useState<KarmaKartState>(() => {
    const kartLine = initialKarmaParsed.kalemler.find((k) => k.tur === 'kredi_karti');
    let banka = '';
    let slip = '';
    if (kartLine?.detay) {
      const bMatch = kartLine.detay.match(/Banka\/POS:\s*([^•]+)/i);
      const sMatch = kartLine.detay.match(/Slip:\s*([^•]+)/i);
      if (bMatch) banka = bMatch[1].trim();
      if (sMatch) slip = sMatch[1].trim();
    }
    return {
      tutar: kartLine ? kartLine.tutarTL.toFixed(2).replace('.', ',') : '',
      paraBirimi: 'TRY',
      kur: '',
      bankaAdi: banka,
      slipNo: slip,
    };
  });
  const [karmaCekler, setKarmaCekler] = useState<KarmaCekRowItem[]>(() => {
    const cekLines = initialKarmaParsed.kalemler.filter((k) => k.tur === 'cek');
    return cekLines.map((k, idx) => {
      const noM = k.detay.match(/No:\s*([^•]+)/i);
      const vadeM = k.detay.match(/Vade:\s*([^•]+)/i);
      const bankaM = k.detay.match(/Banka:\s*([^•]+)/i);
      return {
        id: `karma-cek-${idx}-${Date.now()}`,
        no: noM ? noM[1].trim() : '',
        vade: vadeM ? vadeM[1].trim() : '',
        banka: bankaM ? bankaM[1].trim() : '',
        durum: k.detay.toLowerCase().includes('ciro') ? 'ciro' : 'keside',
        tutar: k.tutarTL.toFixed(2).replace('.', ','),
        paraBirimi: 'TRY',
        kur: '',
      };
    });
  });
  const [karmaSenetler, setKarmaSenetler] = useState<KarmaCekRowItem[]>(() => {
    const senetLines = initialKarmaParsed.kalemler.filter((k) => k.tur === 'senet');
    return senetLines.map((k, idx) => {
      const noM = k.detay.match(/No:\s*([^•]+)/i);
      const vadeM = k.detay.match(/Vade:\s*([^•]+)/i);
      const bankaM = k.detay.match(/Banka:\s*([^•]+)/i);
      return {
        id: `karma-senet-${idx}-${Date.now()}`,
        no: noM ? noM[1].trim() : '',
        vade: vadeM ? vadeM[1].trim() : '',
        banka: bankaM ? bankaM[1].trim() : '',
        durum: k.detay.toLowerCase().includes('ciro') ? 'ciro' : 'keside',
        tutar: k.tutarTL.toFixed(2).replace('.', ','),
        paraBirimi: 'TRY',
        kur: '',
      };
    });
  });
  const [editingKarmaSiblings, setEditingKarmaSiblings] = useState<Islem[]>([]);

  // Çapraz Ödeme Modu (Müşteri Kartı -> Tedarikçiye Ödeme)
  const [isCapraz, setIsCapraz] = useState<boolean>(false);
  const [tedarikciCariId, setTedarikciCariId] = useState<string>('');
  const [tedarikciSearch, setTedarikciSearch] = useState<string>('');
  const [slipNo, setSlipNo] = useState<string>(
    editingIslem?.tur === 'kredi_karti' ? editingIslem.belge_no || '' : ''
  );

  // Sanal POS Konfigürasyonu & Link Oluşturucu
  const [posConfig] = useState<PosConfig>(() => getPosConfig(firma?.id));
  const [posLinkGenerated, setPosLinkGenerated] = useState<PaymentLinkResult | null>(null);

  const [cariler, setCariler] = useState<Cari[]>([]);
  const [cariId, setCariId] = useState<string>(editingIslem?.cari_id || preSelectedCariId || '');
  const [cariSearch, setCariSearch] = useState('');
  const [tutar, setTutar] = useState<string>(() =>
    editingIslem ? Number(editingIslem.tutar).toFixed(2).replace('.', ',') : ''
  );

  // Çoklu Döviz & TCMB Kuru State'leri
  const [paraBirimi, setParaBirimi] = useState<'TRY' | 'USD' | 'EUR'>(initialParsed.paraBirimi);
  const [dovizTutari, setDovizTutari] = useState<string>(initialParsed.dovizTutari);
  const [dovizKuru, setDovizKuru] = useState<string>(initialParsed.dovizKuru);
  const [exchangeRates, setExchangeRates] = useState<ExchangeRates | null>(null);

  // Tarih State'leri (Otomatik takvim açılmasını engeller, takvim butonuna basınca açılır)
  const tarihPickerRef = useRef<HTMLInputElement>(null);
  const [tarihDisplay, setTarihDisplay] = useState<string>(() => {
    if (editingIslem?.tarih) {
      return formatIsoToDisplay(editingIslem.tarih);
    }
    const now = new Date();
    const d = String(now.getDate()).padStart(2, '0');
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const y = now.getFullYear();
    return `${d}.${m}.${y}`;
  });
  const [tarih, setTarih] = useState<string>(
    () => editingIslem?.tarih?.slice(0, 10) || new Date().toISOString().split('T')[0]
  );
  const [aciklama, setAciklama] = useState<string>(() =>
    initialIsKarma ? initialKarmaParsed.cleanNote : initialParsed.aciklamaClean
  );

  // Çek ve Senet alanları
  const cekVadeRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const [belgeNo, setBelgeNo] = useState<string>(editingIslem?.belge_no || '');
  const [vade, setVade] = useState<string>(() => formatIsoToDisplay(editingIslem?.vade));
  const [bankaAdi, setBankaAdi] = useState<string>(editingIslem?.banka_adi || '');

  // Ciro Alanları (Portföydeki Çek/Senet seçimi)
  const [isCiro, setIsCiro] = useState<boolean>(false);
  const [portfoyCekleri, setPortfoyCekleri] = useState<Islem[]>([]);
  const [selectedPortfoyCek, setSelectedPortfoyCek] = useState<Islem | null>(null);

  // Birleşik Çek / Senet Giriş Listesi (1..N adet çek, her birinde kendi tutarı ve para birimi)
  const [cekList, setCekList] = useState<CekRowItem[]>(initialParsed.cekList);
  const [portfoyModalOpen, setPortfoyModalOpen] = useState<boolean>(false);
  const [portfoySearch, setPortfoySearch] = useState<string>('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Kural: isCekSenet değişkeni bileşen içinde tanımlanmalı
  const isCekSenet = !isKarma && (tur === 'cek' || tur === 'senet');

  // Canlı Döviz Kurlarını Çek
  useEffect(() => {
    getExchangeRates().then((rates) => {
      setExchangeRates(rates);
    });
  }, []);

  // Bağlı Karma Makbuz düzenleniyorsa kardeş kalemleri çek ve forma yükle
  useEffect(() => {
    if (!editingIslem || !firma?.id) return;
    const karmaRef = extractKarmaRef(editingIslem.aciklama);
    if (!karmaRef) return;

    let cancelled = false;
    supabase
      .from('islemler')
      .select('*')
      .eq('firma_id', firma.id)
      .eq('iptal', editingIslem.iptal)
      .ilike('aciklama', `%${karmaRef}%`)
      .order('id', { ascending: true })
      .then(({ data }) => {
        if (cancelled || !data || data.length === 0) return;
        const rows = data as Islem[];
        setEditingKarmaSiblings(rows);

        const nakitRow = rows.find((r) => r.tur === 'nakit');
        if (nakitRow) {
          setKarmaNakit({
            tutar: Number(nakitRow.tutar).toFixed(2).replace('.', ','),
            paraBirimi: 'TRY',
            kur: '',
            existingIslemId: nakitRow.id,
          });
        } else {
          setKarmaNakit({ tutar: '', paraBirimi: 'TRY', kur: '' });
        }

        const kartRow = rows.find((r) => r.tur === 'kredi_karti');
        if (kartRow) {
          setKarmaKart({
            tutar: Number(kartRow.tutar).toFixed(2).replace('.', ','),
            paraBirimi: 'TRY',
            kur: '',
            bankaAdi: kartRow.banka_adi || '',
            slipNo: kartRow.belge_no || '',
            existingIslemId: kartRow.id,
          });
        } else {
          setKarmaKart({ tutar: '', paraBirimi: 'TRY', kur: '', bankaAdi: '', slipNo: '' });
        }

        const cekRows = rows.filter((r) => r.tur === 'cek');
        setKarmaCekler(
          cekRows.map((c, idx) => ({
            id: `edit-cek-${c.id}-${idx}`,
            no: c.belge_no || '',
            vade: formatIsoToDisplay(c.vade),
            banka: c.banka_adi || '',
            durum: (c.aciklama || '').toLowerCase().includes('ciro') ? 'ciro' : 'keside',
            tutar: Number(c.tutar).toFixed(2).replace('.', ','),
            paraBirimi: 'TRY',
            kur: '',
            existingIslemId: c.id,
          }))
        );

        const senetRows = rows.filter((r) => r.tur === 'senet');
        setKarmaSenetler(
          senetRows.map((s, idx) => ({
            id: `edit-senet-${s.id}-${idx}`,
            no: s.belge_no || '',
            vade: formatIsoToDisplay(s.vade),
            banka: s.banka_adi || '',
            durum: (s.aciklama || '').toLowerCase().includes('ciro') ? 'ciro' : 'keside',
            tutar: Number(s.tutar).toFixed(2).replace('.', ','),
            paraBirimi: 'TRY',
            kur: '',
            existingIslemId: s.id,
          }))
        );

        // Temiz notu koru
        const lines = buildKarmaLinesFromSiblingIslemler(rows);
        if (lines.length > 0) {
          const parsed = parseKarmaFromAciklama(rows[0].aciklama);
          const cleaned = parsed.cleanNote
            .split('\n')
            .filter((l) => !l.startsWith('[DÖVİZ:'))
            .join('\n')
            .trim();
          setAciklama(cleaned);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [editingIslem?.id, firma?.id]);

  // Portföydeki (Elimizdeki) Müşteri Çek ve Senetlerini Çekme
  useEffect(() => {
    if (!firma?.id || !isCekSenet) {
      setPortfoyCekleri([]);
      return;
    }

    const fetchPortfoy = async () => {
      const { data, error: err } = await supabase
        .from('islemler')
        .select('*, cariler:cari_id(unvan, vergi_tc_no, telefon)')
        .eq('firma_id', firma.id)
        .eq('tip', 'tahsilat')
        .eq('tur', tur)
        .eq('iptal', false)
        .order('vade', { ascending: true });

      if (!err && data) {
        // Zaten ciro edilip çıkışı yapılmış olanları hariç tut
        const available = data.filter((c: any) => {
          const upper = (c.aciklama || '').toUpperCase();
          return !upper.includes('CİRO') && !upper.includes('CIRO') && c.durum !== 'ciro';
        });
        setPortfoyCekleri(available as Islem[]);
      }
    };

    fetchPortfoy();
  }, [firma?.id, isCekSenet, tur]);

  const handleSelectPortfoyCek = (item: Islem) => {
    setSelectedPortfoyCek(item);
    setIsCiro(true);
    setTutar(item.tutar.toString().replace('.', ','));
    setBelgeNo(item.belge_no || '');
    if (item.vade) {
      const parts = item.vade.split('-');
      if (parts.length === 3) {
        setVade(`${parts[2]}.${parts[1]}.${parts[0]}`);
      } else {
        setVade(item.vade);
      }
    }
    setBankaAdi(item.banka_adi || '');
    setPortfoyModalOpen(false);
  };

  const handleClearCiro = () => {
    setSelectedPortfoyCek(null);
    setIsCiro(false);
    setTutar('');
    setBelgeNo('');
    setVade('');
    setBankaAdi('');
  };

  const handleCurrencyChange = (newCurrency: 'TRY' | 'USD' | 'EUR') => {
    setParaBirimi(newCurrency);
    if (newCurrency === 'USD') {
      const rate = exchangeRates?.USD || 38.45;
      setDovizKuru(rate.toString().replace('.', ','));
      if (dovizTutari) {
        const numDoviz = parseFloat(dovizTutari.replace(',', '.'));
        if (!isNaN(numDoviz)) {
          setTutar((numDoviz * rate).toFixed(2).replace('.', ','));
        }
      }
    } else if (newCurrency === 'EUR') {
      const rate = exchangeRates?.EUR || 41.2;
      setDovizKuru(rate.toString().replace('.', ','));
      if (dovizTutari) {
        const numDoviz = parseFloat(dovizTutari.replace(',', '.'));
        if (!isNaN(numDoviz)) {
          setTutar((numDoviz * rate).toFixed(2).replace('.', ','));
        }
      }
    } else {
      if (dovizTutari) {
        setTutar(dovizTutari);
      }
    }
  };

  const handleDovizTutariChange = (val: string) => {
    setDovizTutari(val);
    const numDoviz = parseFloat(val.replace(',', '.'));
    const numKur = parseFloat(dovizKuru.replace(',', '.'));
    if (!isNaN(numDoviz) && !isNaN(numKur)) {
      setTutar((numDoviz * numKur).toFixed(2).replace('.', ','));
    } else {
      setTutar('');
    }
  };

  const handleDovizKuruChange = (val: string) => {
    setDovizKuru(val);
    const numDoviz = parseFloat(dovizTutari.replace(',', '.'));
    const numKur = parseFloat(val.replace(',', '.'));
    if (!isNaN(numDoviz) && !isNaN(numKur)) {
      setTutar((numDoviz * numKur).toFixed(2).replace('.', ','));
    }
  };

  // İşlem tarihi değiştirme (sayı tuşlarıyla GG.AA.YYYY formatında)
  const handleTarihChange = (input: string) => {
    const digits = input.replace(/\D/g, '').slice(0, 8);
    let formatted = '';
    if (digits.length <= 2) {
      formatted = digits;
    } else if (digits.length <= 4) {
      formatted = `${digits.slice(0, 2)}.${digits.slice(2)}`;
    } else {
      formatted = `${digits.slice(0, 2)}.${digits.slice(2, 4)}.${digits.slice(4)}`;
    }
    setTarihDisplay(formatted);
    if (digits.length === 8) {
      const d = digits.slice(0, 2);
      const m = digits.slice(2, 4);
      const y = digits.slice(4, 8);
      setTarih(`${y}-${m}-${d}`);
    }
  };

  const handleTarihPickerChange = (isoVal: string) => {
    if (!isoVal) return;
    setTarih(isoVal);
    const parts = isoVal.split('-');
    if (parts.length === 3) {
      setTarihDisplay(`${parts[2]}.${parts[1]}.${parts[0]}`);
    }
  };

  // Vade tarihini sayılarla girme (takvim açmadan GG.AA.YYYY formatı)
  const handleVadeChange = (input: string) => {
    const digits = input.replace(/\D/g, '').slice(0, 8);
    let formatted = '';
    if (digits.length <= 2) {
      formatted = digits;
    } else if (digits.length <= 4) {
      formatted = `${digits.slice(0, 2)}.${digits.slice(2)}`;
    } else {
      formatted = `${digits.slice(0, 2)}.${digits.slice(2, 4)}.${digits.slice(4)}`;
    }
    setVade(formatted);
  };

  const handleVadePickerChange = (isoVal: string) => {
    if (!isoVal) return;
    const parts = isoVal.split('-');
    if (parts.length === 3) {
      setVade(`${parts[2]}.${parts[1]}.${parts[0]}`);
    }
  };

  const setQuickVadeDays = (days: number) => {
    const d = new Date();
    d.setDate(d.getDate() + days);
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    setVade(`${day}.${month}.${year}`);
  };

  const parseDateToIso = (val: string): string => {
    if (!val) return new Date().toISOString().split('T')[0];
    const digits = val.replace(/\D/g, '');
    if (digits.length === 8) {
      const d = digits.slice(0, 2);
      const m = digits.slice(2, 4);
      const y = digits.slice(4, 8);
      return `${y}-${m}-${d}`;
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(val)) return val;
    return new Date().toISOString().split('T')[0];
  };

  const parseVadeToIso = (val: string): string | null => {
    if (!val) return null;
    const clean = val.trim();
    if (/^\d{2}\.\d{2}\.\d{4}$/.test(clean)) {
      const [d, m, y] = clean.split('.');
      return `${y}-${m}-${d}`;
    }
    return clean;
  };

  // Çek satırı TL karşılığı & toplam hesaplama
  const getCheckTlEquivalent = (item: CekRowItem): number => {
    const raw = parseAmountInput(item.tutar);
    if (raw <= 0) return 0;
    if (item.paraBirimi === 'TRY') return raw;
    const customKur = parseAmountInput(item.kur || '');
    const rate =
      customKur > 0
        ? customKur
        : item.paraBirimi === 'USD'
        ? exchangeRates?.USD || 38.45
        : exchangeRates?.EUR || 41.2;
    return raw * rate;
  };

  const cekToplamTL =
    Math.round(cekList.reduce((acc, item) => acc + getCheckTlEquivalent(item), 0) * 100) / 100;

  // Çek listesi değiştiğinde makbuz tutarını otomatik güncelle (çek toplamına göre)
  useEffect(() => {
    if (isCekSenet && !isCiro && !isCapraz) {
      if (cekToplamTL > 0) {
        setTutar(cekToplamTL.toFixed(2).replace('.', ','));
      } else {
        setTutar('');
      }
    }
  }, [cekToplamTL, isCekSenet, isCiro, isCapraz]);

  const updateCekRow = (id: string, patch: Partial<CekRowItem>) => {
    setCekList((prev) => prev.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  };

  const addCekRow = () => {
    setCekList((prev) => [...prev, createEmptyCekRow()]);
  };

  const removeCekRow = (id: string) => {
    setCekList((prev) => {
      if (prev.length <= 1) return prev;
      return prev.filter((item) => item.id !== id);
    });
  };

  const handleCekVadeChange = (id: string, input: string) => {
    const digits = input.replace(/\D/g, '').slice(0, 8);
    let formatted = '';
    if (digits.length <= 2) {
      formatted = digits;
    } else if (digits.length <= 4) {
      formatted = `${digits.slice(0, 2)}.${digits.slice(2)}`;
    } else {
      formatted = `${digits.slice(0, 2)}.${digits.slice(2, 4)}.${digits.slice(4)}`;
    }
    updateCekRow(id, { vade: formatted });
  };

  const setCekQuickVadeDays = (id: string, days: number) => {
    const d = new Date();
    d.setDate(d.getDate() + days);
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    updateCekRow(id, { vade: `${day}.${month}.${year}` });
  };

  // Carileri yükle
  useEffect(() => {
    if (!firma?.id) return;

    const fetchCariler = async () => {
      const { data, error: err } = await supabase
        .from('cariler')
        .select('*')
        .eq('firma_id', firma.id)
        .order('unvan', { ascending: true });

      if (!err && data) {
        setCariler(data as Cari[]);
        if (!cariId && data.length > 0) {
          // Tahsilatta önce alıcılar, tediyede önce tedarikçiler
          const preferred =
            tip === 'tahsilat'
              ? data.find((c) => c.tur === 'alici') || data[0]
              : data.find((c) => c.tur === 'tedarikci') || data[0];
          setCariId(preferred.id);
        }
      }
    };

    fetchCariler();
  }, [firma?.id, tip]);

  // Sıralama kuralı: Tahsilatta önce alıcılar, tediyede önce tedarikçiler
  const sortedCariler = [...cariler].sort((a, b) => {
    if (tip === 'tahsilat') {
      if (a.tur === 'alici' && b.tur !== 'alici') return -1;
      if (a.tur !== 'alici' && b.tur === 'alici') return 1;
    } else {
      if (a.tur === 'tedarikci' && b.tur !== 'tedarikci') return -1;
      if (a.tur !== 'tedarikci' && b.tur === 'tedarikci') return 1;
    }
    return a.unvan.localeCompare(b.unvan, 'tr');
  });

  const filteredCariler = sortedCariler.filter(
    (c) =>
      c.unvan.toLowerCase().includes(cariSearch.toLowerCase()) ||
      (c.vergi_tc_no && c.vergi_tc_no.includes(cariSearch))
  );

  const selectedCari = cariler.find((c) => c.id === cariId);
  const selectedTedarikci = cariler.find((c) => c.id === tedarikciCariId);

  const filteredTedarikciler = cariler
    .filter((c) => c.id !== cariId)
    .sort((a, b) => {
      if (a.tur === 'tedarikci' && b.tur !== 'tedarikci') return -1;
      if (a.tur !== 'tedarikci' && b.tur === 'tedarikci') return 1;
      return a.unvan.localeCompare(b.unvan, 'tr');
    })
    .filter(
      (c) =>
        c.unvan.toLowerCase().includes(tedarikciSearch.toLowerCase()) ||
        (c.vergi_tc_no && c.vergi_tc_no.includes(tedarikciSearch))
    );

  const handleCreatePosLink = () => {
    const num = parseFloat(tutar.replace(',', '.'));
    if (isNaN(num) || num <= 0) {
      setError('Lütfen önce ödenecek tutarı giriniz.');
      return;
    }
    const customer = selectedCari?.unvan || 'Müşteri';
    const linkResult = generatePaymentLink({
      amount: num,
      customerName: customer,
      customerPhone: selectedCari?.telefon || undefined,
      description: aciklama || undefined,
      config: posConfig,
    });
    setPosLinkGenerated(linkResult);
    if (!slipNo) {
      setSlipNo(linkResult.referenceNo);
    }
  };

  // Karma Makbuz Canlı Tutar Hesaplamaları
  const karmaNakitTL = getRowTlEquivalent(
    karmaNakit.tutar,
    karmaNakit.paraBirimi,
    karmaNakit.kur,
    exchangeRates
  );
  const karmaKartTL = getRowTlEquivalent(
    karmaKart.tutar,
    karmaKart.paraBirimi,
    karmaKart.kur,
    exchangeRates
  );
  const karmaCeklerTL =
    Math.round(
      karmaCekler.reduce(
        (acc, c) => acc + getRowTlEquivalent(c.tutar, c.paraBirimi, c.kur, exchangeRates),
        0
      ) * 100
    ) / 100;
  const karmaSenetlerTL =
    Math.round(
      karmaSenetler.reduce(
        (acc, s) => acc + getRowTlEquivalent(s.tutar, s.paraBirimi, s.kur, exchangeRates),
        0
      ) * 100
    ) / 100;
  const karmaGrandTotal =
    Math.round((karmaNakitTL + karmaKartTL + karmaCeklerTL + karmaSenetlerTL) * 100) / 100;

  const handleCreatePosLinkForKarma = (kartAmountTl: number) => {
    if (isNaN(kartAmountTl) || kartAmountTl <= 0) {
      setError('Lütfen önce Kredi Kartı tutarını giriniz.');
      return;
    }
    const customer = selectedCari?.unvan || 'Müşteri';
    const linkResult = generatePaymentLink({
      amount: kartAmountTl,
      customerName: customer,
      customerPhone: selectedCari?.telefon || undefined,
      description: aciklama || undefined,
      config: posConfig,
    });
    setPosLinkGenerated(linkResult);
    if (!karmaKart.slipNo) {
      setKarmaKart((prev) => ({ ...prev, slipNo: linkResult.referenceNo }));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const effectiveFirmaId = selectedCari?.firma_id || profile?.firma_id || firma?.id;
    if (!effectiveFirmaId) {
      setError('Firma bilgisi bulunamadı. Lütfen oturumu kapatıp tekrar giriş yapınız.');
      return;
    }

    // 1. ÇAPRAZ ÖDEME MODU (Müşteri Kartı -> Tedarikçiye Ödeme)
    if (isCapraz) {
      if (!cariId) {
        setError('Lütfen kart sahibi olan Müşteri (Alıcı) carisini seçiniz.');
        return;
      }
      if (!tedarikciCariId) {
        setError('Lütfen ödeme yapılacak Tedarikçi carisini seçiniz.');
        return;
      }
      if (cariId === tedarikciCariId) {
        setError('Müşteri ve Tedarikçi aynı cari olamaz.');
        return;
      }
      const numTutar = parseFloat(tutar.replace(',', '.'));
      if (isNaN(numTutar) || numTutar <= 0) {
        setError('Lütfen geçerli bir tutar giriniz.');
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const { data: sessionData } = await supabase.auth.getSession();
        if (!sessionData.session) {
          setError('Oturum süreniz dolmuş. Lütfen sayfayı yenileyiniz veya tekrar giriş yapınız.');
          setLoading(false);
          return;
        }

        const refNo = slipNo.trim() || `ÇPZ-${Date.now().toString().slice(-6)}`;
        const parsedTarih = parseDateToIso(tarihDisplay) || tarih || new Date().toISOString().split('T')[0];

        let dovizNotu = '';
        if (paraBirimi !== 'TRY' && dovizTutari) {
          dovizNotu = `[DÖVİZ: ${dovizTutari} ${paraBirimi} (Kur: ${dovizKuru} TL)] `;
        }

        // A) MÜŞTERİ TAHSİLAT KAYDI (Müşterinin kartından çekim yapıldı)
        const musteriAciklama = `[ÇAPRAZ ÖDEME - Ref: ${refNo}] ${selectedTedarikci?.unvan || 'Tedarikçi'} firmasına aktarıldı. ${dovizNotu}${aciklama.trim()}`.trim();
        const musteriPayload: Record<string, any> = {
          firma_id: effectiveFirmaId,
          cari_id: cariId,
          tip: 'tahsilat',
          tur: 'kredi_karti',
          tutar: numTutar,
          tarih: parsedTarih,
          belge_no: refNo,
          banka_adi: bankaAdi.trim() || (posConfig.enabled && posConfig.provider !== 'none' ? posConfig.provider.toUpperCase() : 'Kredi Kartı'),
          aciklama: musteriAciklama,
        };

        const { data: insertedMusteri, error: mErr } = await supabase
          .from('islemler')
          .insert(musteriPayload)
          .select('*, cariler:cari_id(unvan, vergi_tc_no, telefon, email, bakiye), profiles:yapan_user_id(ad_soyad)')
          .single();

        if (mErr) throw mErr;

        // B) TEDARİKÇİ TEDİYE KAYDI (Tedarikçiye müşteri kartıyla ödendi)
        const tedarikciAciklama = `[ÇAPRAZ ÖDEME - Ref: ${refNo}] ${selectedCari?.unvan || 'Müşteri'} kartıyla ödendi. ${dovizNotu}${aciklama.trim()}`.trim();
        const tedarikciPayload: Record<string, any> = {
          firma_id: effectiveFirmaId,
          cari_id: tedarikciCariId,
          tip: 'tediye',
          tur: 'kredi_karti',
          tutar: numTutar,
          tarih: parsedTarih,
          belge_no: refNo,
          banka_adi: bankaAdi.trim() || (posConfig.enabled && posConfig.provider !== 'none' ? posConfig.provider.toUpperCase() : 'Kredi Kartı'),
          aciklama: tedarikciAciklama,
        };

        const { error: tErr } = await supabase
          .from('islemler')
          .insert(tedarikciPayload);

        if (tErr) throw tErr;

        // Başarılı: Müşterinin tahsilat makbuzunu aç
        onSuccess(insertedMusteri as Islem);
        return;
      } catch (err: unknown) {
        const isUnlimitedOrActive =
          Boolean(firma?.sinirsiz) ||
          periodInfo.status === 'active_package' ||
          periodInfo.status === 'active_trial';
        refreshProfileAndFirma();
        setError(
          handleSupabaseError(err, 'Çapraz ödeme kaydı tamamlanamadı.', {
            isFirmaUnlimited: isUnlimitedOrActive,
          })
        );
        return;
      } finally {
        setLoading(false);
      }
    }

    // 1.5 KARMA (ÇOKLU ÖDEME TÜRÜ: NAKİT + KART + ÇEK + SENET) MODU
    if (isKarma) {
      if (!cariId) {
        setError('Lütfen bir cari hesap seçiniz.');
        return;
      }

      for (let i = 0; i < karmaCekler.length; i++) {
        const c = karmaCekler[i];
        const amt = parseAmountInput(c.tutar);
        if (amt <= 0) {
          setError(`Lütfen ${i + 1}. çekin tutarını giriniz (veya boş satırı kaldırınız).`);
          return;
        }
        if (!c.vade || c.vade.replace(/\D/g, '').length !== 8) {
          setError(`Lütfen ${i + 1}. çekin vade tarihini tam olarak giriniz (Örn: 15.12.2026).`);
          return;
        }
      }

      for (let i = 0; i < karmaSenetler.length; i++) {
        const s = karmaSenetler[i];
        const amt = parseAmountInput(s.tutar);
        if (amt <= 0) {
          setError(`Lütfen ${i + 1}. senedin tutarını giriniz (veya boş satırı kaldırınız).`);
          return;
        }
        if (!s.vade || s.vade.replace(/\D/g, '').length !== 8) {
          setError(`Lütfen ${i + 1}. senedin vade tarihini tam olarak giriniz (Örn: 15.12.2026).`);
          return;
        }
      }

      if (karmaGrandTotal <= 0) {
        setError('Karma makbuz için en az bir ödeme türünde (Nakit, Kredi Kartı, Çek veya Senet) tutar giriniz.');
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const { data: sessionData } = await supabase.auth.getSession();
        if (!sessionData.session) {
          setError('Oturum süreniz dolmuş. Lütfen sayfayı yenileyiniz veya tekrar giriş yapınız.');
          setLoading(false);
          return;
        }

        const parsedTarih = parseDateToIso(tarihDisplay) || tarih || new Date().toISOString().split('T')[0];
        const cleanUserNote = aciklama.trim();

        const formatOrigCurrency = (
          tutarStr: string,
          curr: 'TRY' | 'USD' | 'EUR',
          kurStr: string | undefined
        ): string | undefined => {
          if (curr === 'TRY') return undefined;
          const rate = getCurrencyRate(curr, kurStr, exchangeRates);
          const rawVal = parseAmountInput(tutarStr);
          return `${formatTrAmount(rawVal)} ${curr} (Kur: ${rate.toString().replace('.', ',')} TL)`;
        };

        if (karmaSaveMode === 'tek_satir') {
          // TEK SATIR BİRLEŞİK MAKBUZ OLARAK KAYDET
          const kalemLines: string[] = [];
          const totalsByTur: Record<IslemTur, number> = {
            nakit: karmaNakitTL,
            kredi_karti: karmaKartTL,
            cek: karmaCeklerTL,
            senet: karmaSenetlerTL,
          };

          if (karmaNakitTL > 0) {
            kalemLines.push(
              buildKarmaKalemLine(
                'nakit',
                'Peşin / Kasa',
                karmaNakitTL,
                formatOrigCurrency(karmaNakit.tutar, karmaNakit.paraBirimi, karmaNakit.kur)
              )
            );
          }

          if (karmaKartTL > 0) {
            const cardBank =
              karmaKart.bankaAdi.trim() ||
              (posConfig.enabled && posConfig.provider !== 'none' ? posConfig.provider.toUpperCase() : '');
            const kartDetails = [
              cardBank ? `Banka/POS: ${cardBank}` : '',
              karmaKart.slipNo.trim() ? `Slip: ${karmaKart.slipNo.trim()}` : '',
            ]
              .filter(Boolean)
              .join(' • ');
            kalemLines.push(
              buildKarmaKalemLine(
                'kredi_karti',
                kartDetails || 'Kredi Kartı / POS',
                karmaKartTL,
                formatOrigCurrency(karmaKart.tutar, karmaKart.paraBirimi, karmaKart.kur)
              )
            );
          }

          for (const c of karmaCekler) {
            const cTl = getRowTlEquivalent(c.tutar, c.paraBirimi, c.kur, exchangeRates);
            const cParts = [
              c.no.trim() ? `No: ${c.no.trim()}` : '',
              c.vade.trim() ? `Vade: ${c.vade.trim()}` : '',
              c.banka.trim() ? `Banka: ${c.banka.trim()}` : '',
              c.durum === 'ciro' ? 'Ciro' : 'Keşide',
            ]
              .filter(Boolean)
              .join(' • ');
            kalemLines.push(
              buildKarmaKalemLine(
                'cek',
                cParts,
                cTl,
                formatOrigCurrency(c.tutar, c.paraBirimi, c.kur)
              )
            );
          }

          for (const s of karmaSenetler) {
            const sTl = getRowTlEquivalent(s.tutar, s.paraBirimi, s.kur, exchangeRates);
            const sParts = [
              s.no.trim() ? `No: ${s.no.trim()}` : '',
              s.vade.trim() ? `Vade: ${s.vade.trim()}` : '',
              s.banka.trim() ? `Banka: ${s.banka.trim()}` : '',
              s.durum === 'ciro' ? 'Ciro' : 'Keşide',
            ]
              .filter(Boolean)
              .join(' • ');
            kalemLines.push(
              buildKarmaKalemLine(
                'senet',
                sParts,
                sTl,
                formatOrigCurrency(s.tutar, s.paraBirimi, s.kur)
              )
            );
          }

          // En yüksek tutarlı türü ana `tur` kolonu yap
          const primaryTur = (Object.entries(totalsByTur).sort((a, b) => b[1] - a[1])[0]?.[0] ||
            'nakit') as IslemTur;
          const allVades = [...karmaCekler, ...karmaSenetler]
            .map((x) => parseVadeToIso(x.vade))
            .filter((v): v is string => Boolean(v))
            .sort();
          const docNos = [
            karmaKart.slipNo.trim(),
            ...karmaCekler.map((c) => c.no.trim()),
            ...karmaSenetler.map((s) => s.no.trim()),
          ].filter(Boolean);

          const singleAciklama = [cleanUserNote, ...kalemLines].filter(Boolean).join('\n');
          const payload: Record<string, any> = {
            cari_id: cariId,
            tip,
            tur: primaryTur,
            tutar: karmaGrandTotal,
            tarih: parsedTarih,
            belge_no: docNos[0] || null,
            vade: allVades[0] || null,
            banka_adi:
              karmaKart.bankaAdi.trim() ||
              karmaCekler.find((c) => c.banka.trim())?.banka.trim() ||
              karmaSenetler.find((s) => s.banka.trim())?.banka.trim() ||
              null,
            aciklama: singleAciklama,
          };

          if (!isEditing) {
            payload.firma_id = effectiveFirmaId;
            const { data: insertedData, error: insertErr } = await supabase
              .from('islemler')
              .insert(payload)
              .select('*, cariler:cari_id(unvan, vergi_tc_no, telefon, email, bakiye), profiles:yapan_user_id(ad_soyad)')
              .single();
            if (insertErr) throw insertErr;
            onSuccess(insertedData as Islem);
            return;
          } else if (editingIslem) {
            const { data: updatedData, error: updateErr } = await supabase
              .from('islemler')
              .update(payload)
              .eq('id', editingIslem.id)
              .eq('firma_id', effectiveFirmaId)
              .select('*, cariler:cari_id(unvan, vergi_tc_no, telefon, email, bakiye), profiles:yapan_user_id(ad_soyad)')
              .single();
            if (updateErr) throw updateErr;
            onSuccess(updatedData as Islem);
            return;
          }
        } else {
          // ORTAK MAKBUZ + TÜR BAZLI KALEMLER (ÖNERİLEN)
          const existingRef = editingIslem ? extractKarmaRef(editingIslem.aciklama) : null;
          const refNo = existingRef || `KRM-${Date.now().toString().slice(-6)}`;
          const karmaTag = `[KARMA MAKBUZ - Ref: ${refNo} | Genel Toplam: ${formatTrAmount(karmaGrandTotal)} TL]`;

          type PlannedEntry = {
            existingId?: string;
            payload: Record<string, any>;
          };

          const entries: PlannedEntry[] = [];
          const buildRowAciklama = (extraTag?: string) =>
            [karmaTag, extraTag || '', cleanUserNote].filter(Boolean).join('\n');

          if (karmaNakitTL > 0) {
            const orig = formatOrigCurrency(karmaNakit.tutar, karmaNakit.paraBirimi, karmaNakit.kur);
            entries.push({
              existingId: karmaNakit.existingIslemId,
              payload: {
                cari_id: cariId,
                tip,
                tur: 'nakit',
                tutar: karmaNakitTL,
                tarih: parsedTarih,
                belge_no: refNo,
                vade: null,
                banka_adi: null,
                aciklama: buildRowAciklama(orig ? `[DÖVİZ: ${orig}]` : undefined),
              },
            });
          }

          if (karmaKartTL > 0) {
            const orig = formatOrigCurrency(karmaKart.tutar, karmaKart.paraBirimi, karmaKart.kur);
            const bankVal =
              karmaKart.bankaAdi.trim() ||
              (posConfig.enabled && posConfig.provider !== 'none' ? posConfig.provider.toUpperCase() : null);
            entries.push({
              existingId: karmaKart.existingIslemId,
              payload: {
                cari_id: cariId,
                tip,
                tur: 'kredi_karti',
                tutar: karmaKartTL,
                tarih: parsedTarih,
                belge_no: karmaKart.slipNo.trim() || refNo,
                vade: null,
                banka_adi: bankVal,
                aciklama: buildRowAciklama(orig ? `[DÖVİZ: ${orig}]` : undefined),
              },
            });
          }

          for (const c of karmaCekler) {
            const cTl = getRowTlEquivalent(c.tutar, c.paraBirimi, c.kur, exchangeRates);
            const orig = formatOrigCurrency(c.tutar, c.paraBirimi, c.kur);
            const ciroTag = c.durum === 'ciro' ? '[CİRO]' : '';
            const dovizTag = orig ? `[DÖVİZ: ${orig}]` : '';
            entries.push({
              existingId: c.existingIslemId,
              payload: {
                cari_id: cariId,
                tip,
                tur: 'cek',
                tutar: cTl,
                tarih: parsedTarih,
                belge_no: c.no.trim() || refNo,
                vade: parseVadeToIso(c.vade),
                banka_adi: c.banka.trim() || null,
                aciklama: buildRowAciklama([ciroTag, dovizTag].filter(Boolean).join(' ')),
              },
            });
          }

          for (const s of karmaSenetler) {
            const sTl = getRowTlEquivalent(s.tutar, s.paraBirimi, s.kur, exchangeRates);
            const orig = formatOrigCurrency(s.tutar, s.paraBirimi, s.kur);
            const ciroTag = s.durum === 'ciro' ? '[CİRO]' : '';
            const dovizTag = orig ? `[DÖVİZ: ${orig}]` : '';
            entries.push({
              existingId: s.existingIslemId,
              payload: {
                cari_id: cariId,
                tip,
                tur: 'senet',
                tutar: sTl,
                tarih: parsedTarih,
                belge_no: s.no.trim() || refNo,
                vade: parseVadeToIso(s.vade),
                banka_adi: s.banka.trim() || null,
                aciklama: buildRowAciklama([ciroTag, dovizTag].filter(Boolean).join(' ')),
              },
            });
          }

          if (!isEditing) {
            const insertPayloads = entries.map((item) => ({
              ...item.payload,
              firma_id: effectiveFirmaId,
            }));

            const { data: insertedRows, error: insertErr } = await supabase
              .from('islemler')
              .insert(insertPayloads)
              .select('*, cariler:cari_id(unvan, vergi_tc_no, telefon, email, bakiye), profiles:yapan_user_id(ad_soyad)');

            if (insertErr) throw insertErr;
            if (insertedRows && insertedRows.length > 0) {
              onSuccess(insertedRows[0] as Islem);
              return;
            }
          } else if (editingIslem) {
            const sourceSiblings = editingKarmaSiblings.length > 0 ? editingKarmaSiblings : [editingIslem];
            const keptIds = new Set<string>();
            let firstSaved: Islem | null = null;

            for (const entry of entries) {
              if (entry.existingId) {
                keptIds.add(entry.existingId);
                const { data: upd, error: uErr } = await supabase
                  .from('islemler')
                  .update(entry.payload)
                  .eq('id', entry.existingId)
                  .eq('firma_id', effectiveFirmaId)
                  .select('*, cariler:cari_id(unvan, vergi_tc_no, telefon, email, bakiye), profiles:yapan_user_id(ad_soyad)')
                  .single();
                if (uErr) throw uErr;
                if (!firstSaved && upd) firstSaved = upd as Islem;
              } else {
                const { data: ins, error: iErr } = await supabase
                  .from('islemler')
                  .insert({ ...entry.payload, firma_id: effectiveFirmaId })
                  .select('*, cariler:cari_id(unvan, vergi_tc_no, telefon, email, bakiye), profiles:yapan_user_id(ad_soyad)')
                  .single();
                if (iErr) throw iErr;
                if (!firstSaved && ins) firstSaved = ins as Islem;
              }
            }

            // Düzenleme sırasında kaldırılan eski kalemleri temizle
            for (const oldRow of sourceSiblings) {
              if (!keptIds.has(oldRow.id)) {
                const { error: delErr } = await supabase
                  .from('islemler')
                  .delete()
                  .eq('id', oldRow.id)
                  .eq('firma_id', effectiveFirmaId);
                if (delErr) {
                  await supabase
                    .from('islemler')
                    .update({ iptal: true, iptal_nedeni: 'Karma makbuz güncellemesinde kaldırıldı' })
                    .eq('id', oldRow.id)
                    .eq('firma_id', effectiveFirmaId);
                }
              }
            }

            if (firstSaved) {
              onSuccess(firstSaved);
              return;
            }
          }
        }
      } catch (err: unknown) {
        const isUnlimitedOrActive =
          Boolean(firma?.sinirsiz) ||
          periodInfo.status === 'active_package' ||
          periodInfo.status === 'active_trial';
        refreshProfileAndFirma();
        setError(
          handleSupabaseError(
            err,
            isEditing ? 'Karma makbuz güncellenemedi.' : 'Karma makbuz kaydedilemedi.',
            { isFirmaUnlimited: isUnlimitedOrActive }
          )
        );
        return;
      } finally {
        setLoading(false);
      }
    }

    // 2. STANDART İŞLEM / GÜNCELLEME MODU
    if (!cariId) {
      setError('Lütfen bir cari hesap seçiniz.');
      return;
    }

    let numTutar = parseAmountInput(tutar);
    if (isCekSenet && !isCiro) {
      for (let i = 0; i < cekList.length; i++) {
        const c = cekList[i];
        const amt = parseAmountInput(c.tutar);
        if (amt <= 0) {
          setError(`Lütfen ${i + 1}. ${tur === 'cek' ? 'çekin' : 'senedin'} tutarını giriniz.`);
          return;
        }
        if (!c.vade || c.vade.replace(/\D/g, '').length !== 8) {
          setError(
            `Lütfen ${i + 1}. ${tur === 'cek' ? 'çekin' : 'senedin'} vade tarihini tam olarak giriniz (Örn: 15.12.2026).`
          );
          return;
        }
      }
      numTutar = cekToplamTL;
    }

    if (isNaN(numTutar) || numTutar <= 0) {
      setError('Lütfen geçerli bir tutar giriniz.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // Oturum tazeleme kontrolü
      const { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData.session) {
        setError('Oturum süreniz dolmuş. Lütfen sayfayı yenileyiniz veya tekrar giriş yapınız.');
        setLoading(false);
        return;
      }

      const payload: Record<string, any> = {
        cari_id: cariId,
        tip,
        tur,
        tutar: numTutar,
        tarih: parseDateToIso(tarihDisplay) || tarih || new Date().toISOString().split('T')[0],
        belge_no: null,
        vade: null,
        banka_adi: null,
      };

      if (!isEditing) {
        // Kural: islemler insert ederken makbuz_no, yapan_user_id, durum ALANLARINI GÖNDERME!
        // Trigger atar; plasiyer ise durum='plasiyerde'.
        payload.firma_id = effectiveFirmaId;
      }

      let finalAciklama = aciklama.trim();
      if (!isCekSenet && paraBirimi !== 'TRY' && dovizTutari) {
        const dovizNotu = `[DÖVİZ: ${dovizTutari} ${paraBirimi} (Kur: ${dovizKuru} TL)]`;
        finalAciklama = finalAciklama ? `${dovizNotu} - ${finalAciklama}` : dovizNotu;
      }

      if (tur === 'kredi_karti') {
        payload.belge_no = slipNo.trim() || null;
        payload.banka_adi =
          bankaAdi.trim() || (posConfig.enabled && posConfig.provider !== 'none' ? posConfig.provider.toUpperCase() : null);
      }

      if (isCekSenet) {
        if (isCiro) {
          if (!vade || vade.replace(/\D/g, '').length !== 8) {
            setError('Lütfen çek/senet vade tarihini tam olarak giriniz (Örn: 15.12.2026).');
            setLoading(false);
            return;
          }
          payload.belge_no = belgeNo.trim() || null;
          payload.vade = parseVadeToIso(vade);
          payload.banka_adi = bankaAdi.trim() || null;

          if (selectedPortfoyCek) {
            const originalUnvan = selectedPortfoyCek.cariler?.unvan || 'Müşteri';
            const ciroNotu = `[CİRO EDİLDİ - Asıl Borçlu: ${originalUnvan}, Belge No: ${selectedPortfoyCek.belge_no || '-'}]`;
            finalAciklama = finalAciklama ? `${ciroNotu} ${finalAciklama}` : ciroNotu;
          }
        } else {
          const cekLines = cekList.map((c) => {
            const noPart = c.no.trim() ? `${c.no.trim()} nl.` : 'Belgesiz nl.';
            const vadePart = c.vade.trim() ? `${c.vade.trim()} vd.` : '- vd.';
            const bankaPart = c.banka.trim() ? `${c.banka.trim()} banka` : '- banka';
            const durumPart = c.durum === 'ciro' ? 'ciro' : 'keşide';
            const rawVal = parseAmountInput(c.tutar);
            const formattedVal = rawVal.toLocaleString('tr-TR', {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            });
            const currLabel = c.paraBirimi === 'TRY' ? 'TL' : c.paraBirimi;
            return `${noPart} ${vadePart} ${bankaPart} ${durumPart} ${formattedVal} ${currLabel}`;
          });

          if (cekList.length > 1) {
            const cokluNotu = cekLines.join('\n');
            finalAciklama = finalAciklama ? `${finalAciklama}\n${cokluNotu}` : cokluNotu;
            payload.belge_no = cekList[0].no.trim()
              ? `${cekList[0].no.trim()} (+${cekList.length - 1})`
              : `${cekList.length} Adet ${tur === 'cek' ? 'Çek' : 'Senet'}`;
            payload.vade = parseVadeToIso(cekList[0].vade);
            payload.banka_adi = cekList[0].banka.trim() || null;
          } else {
            const tek = cekList[0];
            payload.belge_no = tek.no.trim() || null;
            payload.vade = parseVadeToIso(tek.vade);
            payload.banka_adi = tek.banka.trim() || null;
            // Tek çekte ciro veya döviz seçildiyse detayını koru
            if (tek.durum === 'ciro' || tek.paraBirimi !== 'TRY') {
              finalAciklama = finalAciklama ? `${finalAciklama}\n${cekLines[0]}` : cekLines[0];
            }
          }
        }
      }
      payload.aciklama = finalAciklama || null;

      let savedRecord: Islem | null = null;

      if (isEditing && editingIslem) {
        const { data: updatedData, error: updateErr } = await supabase
          .from('islemler')
          .update(payload)
          .eq('id', editingIslem.id)
          .eq('firma_id', effectiveFirmaId)
          .select('*, cariler:cari_id(unvan, vergi_tc_no, telefon, email, bakiye), profiles:yapan_user_id(ad_soyad)')
          .single();

        if (updateErr) throw updateErr;
        savedRecord = updatedData as Islem;
      } else {
        const { data: insertedData, error: insertErr } = await supabase
          .from('islemler')
          .insert(payload)
          .select('*, cariler:cari_id(unvan, vergi_tc_no, telefon, email, bakiye), profiles:yapan_user_id(ad_soyad)')
          .single();

        if (insertErr) throw insertErr;
        savedRecord = insertedData as Islem;

        // Ciro edildiyse, portföydeki orijinal çeki ciroya verildi olarak güncelle
        if (isCiro && selectedPortfoyCek) {
          const targetCari = cariler.find((c) => c.id === cariId);
          const targetUnvan = targetCari?.unvan || 'Tedarikçi';
          const originalAciklama = selectedPortfoyCek.aciklama || '';
          await supabase
            .from('islemler')
            .update({
              aciklama: `${originalAciklama} [CİRO EDİLDİ -> ${targetUnvan}]`.trim(),
            })
            .eq('id', selectedPortfoyCek.id);
        }
      }

      if (savedRecord) {
        onSuccess(savedRecord);
      }
    } catch (err: unknown) {
      const isUnlimitedOrActive =
        Boolean(firma?.sinirsiz) ||
        periodInfo.status === 'active_package' ||
        periodInfo.status === 'active_trial';
      refreshProfileAndFirma();
      setError(
        handleSupabaseError(
          err,
          isEditing ? 'Makbuz güncellenemedi.' : 'İşlem makbuzu kaydedilemedi.',
          { isFirmaUnlimited: isUnlimitedOrActive }
        )
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* BAŞLIK & EYEBROW */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div
            className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold uppercase tracking-wider mb-2 ${
              isEditing
                ? 'bg-amber-500/15 border border-amber-500/30 text-amber-300'
                : isCapraz
                ? 'bg-purple-500/10 border border-purple-500/30 text-purple-300'
                : tip === 'tahsilat'
                ? 'bg-teal-500/10 border border-teal-500/20 text-teal-400'
                : 'bg-orange-500/10 border border-orange-500/20 text-orange-400'
            }`}
          >
            {isEditing ? (
              <>
                <Pencil className="w-3 h-3 text-amber-400" />
                <span>Makbuz Güncelleme</span>
              </>
            ) : isCapraz ? (
              <>
                <ArrowRightLeft className="w-3 h-3 text-purple-400" />
                <span>Çapraz Kart İşlemi</span>
              </>
            ) : tip === 'tahsilat' ? (
              <>
                <ArrowDownLeft className="w-3 h-3" />
                <span>Para Girişi</span>
              </>
            ) : (
              <>
                <ArrowUpRight className="w-3 h-3" />
                <span>Para Çıkışı</span>
              </>
            )}
          </div>
          <h1 className="text-2xl font-extrabold text-white tracking-tight">
            {isEditing
              ? `Makbuzu Güncelle (${editingIslem?.makbuz_no || `#${editingIslem?.id.slice(0, 8)}`})`
              : isCapraz
              ? 'Müşteri Kartıyla Tedarikçiye Ödeme'
              : tip === 'tahsilat'
              ? 'Tahsilat Makbuzu Düzenle'
              : 'Tediye Makbuzu Düzenle'}
          </h1>
          <p className="text-xs text-gray-400 mt-1">
            {isEditing
              ? 'Mevcut makbuzun cari, tutar, vade, çek veya açıklama bilgilerini güncelleyin'
              : isCapraz
              ? 'Müşterinizin kredi kartından tahsilat yapılıp tedarikçinize aynı anda tediye ödemesi olarak bağlanır'
              : tip === 'tahsilat'
              ? 'Müşteriden yapılan nakit, kart veya çek/senet tahsilatını kaydedin'
              : 'Tedarikçiye veya masraflara yapılan ödemeleri kaydedin'}
          </p>
        </div>

        {/* Hızlı İşlem Türü Değiştirici: Tahsilat / Tediye / Çapraz Ödeme */}
        <div className="flex rounded-xl bg-black/40 p-1 border border-white/[0.06] text-xs">
          <button
            type="button"
            onClick={() => {
              setIsCapraz(false);
              setTip('tahsilat');
            }}
            className={`px-3 py-1.5 rounded-lg font-bold transition flex items-center gap-1.5 ${
              !isCapraz && tip === 'tahsilat'
                ? 'bg-teal-400 text-[#0a0e13] shadow'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            <ArrowDownLeft className="w-3.5 h-3.5" />
            <span>Tahsilat</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setIsCapraz(false);
              setTip('tediye');
            }}
            className={`px-3 py-1.5 rounded-lg font-bold transition flex items-center gap-1.5 ${
              !isCapraz && tip === 'tediye'
                ? 'bg-orange-400 text-[#0a0e13] shadow'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            <ArrowUpRight className="w-3.5 h-3.5" />
            <span>Tediye</span>
          </button>
          {!isEditing && (
            <button
              type="button"
              onClick={() => {
                setIsCapraz(true);
                setIsKarma(false);
                setTip('tahsilat');
                setTur('kredi_karti');
              }}
              className={`px-3 py-1.5 rounded-lg font-bold transition flex items-center gap-1.5 ${
                isCapraz
                  ? 'bg-purple-500 text-white shadow-[0_0_15px_rgba(168,85,247,0.4)]'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              <ArrowRightLeft className="w-3.5 h-3.5" />
              <span>Çapraz Ödeme</span>
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs flex items-center gap-2.5">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* FORM KARTI */}
      <form onSubmit={handleSubmit} className="bg-[#111820] border border-white/[0.08] rounded-2xl p-6 shadow-2xl space-y-6">
        {/* ÇAPRAZ ÖDEME MODU İKİLİ CARİ SEÇİMİ */}
        {isCapraz ? (
          <div className="space-y-4 p-4 rounded-xl bg-purple-500/5 border border-purple-500/20">
            <div className="flex items-center justify-between pb-2 border-b border-purple-500/20">
              <span className="font-bold text-purple-300 text-xs uppercase tracking-wider flex items-center gap-2">
                <ArrowRightLeft className="w-4 h-4 text-purple-400" />
                <span>Çapraz İşlem Cari Eşleşmesi (Alıcı ➔ Tedarikçi)</span>
              </span>
              <span className="text-[11px] text-gray-400">
                1 Tahsilat + 1 Tediye aynı anda bağlanır
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* 1. KART SAHİBİ MÜŞTERİ (ALICI) */}
              <div className="space-y-2">
                <label className="text-xs font-bold text-teal-400 uppercase tracking-wider block">
                  1. Müşteri (Kart Sahibi) *
                </label>
                <div className="relative">
                  <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-gray-400" />
                  <input
                    type="text"
                    value={cariSearch}
                    onChange={(e) => setCariSearch(e.target.value)}
                    placeholder="Müşteri ara..."
                    className="w-full bg-[#0a0e13] border border-white/10 rounded-xl pl-8 pr-3 py-1.5 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-teal-400"
                  />
                </div>
                <select
                  required
                  value={cariId}
                  onChange={(e) => setCariId(e.target.value)}
                  className="w-full bg-[#0a0e13] border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-teal-400"
                >
                  <option value="" disabled>Müşteri (Alıcı) Seçiniz...</option>
                  {filteredCariler.map((c) => (
                    <option key={c.id} value={c.id}>
                      [{c.tur === 'alici' ? 'ALICI' : 'CARİ'}] {c.unvan} ({formatCurrency(c.bakiye)})
                    </option>
                  ))}
                </select>
                {selectedCari && (
                  <div className="p-2 rounded-lg bg-black/40 text-[11px] flex justify-between items-center border border-white/5">
                    <span className="text-gray-300 truncate max-w-[140px]">{selectedCari.unvan}</span>
                    <span className="font-bold text-teal-400">{formatCurrency(selectedCari.bakiye)}</span>
                  </div>
                )}
              </div>

              {/* 2. ÖDEME YAPILACAK TEDARİKÇİ */}
              <div className="space-y-2">
                <label className="text-xs font-bold text-orange-400 uppercase tracking-wider block">
                  2. Tedarikçi (Ödeme Yapılacak) *
                </label>
                <div className="relative">
                  <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-gray-400" />
                  <input
                    type="text"
                    value={tedarikciSearch}
                    onChange={(e) => setTedarikciSearch(e.target.value)}
                    placeholder="Tedarikçi ara..."
                    className="w-full bg-[#0a0e13] border border-white/10 rounded-xl pl-8 pr-3 py-1.5 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-orange-400"
                  />
                </div>
                <select
                  required
                  value={tedarikciCariId}
                  onChange={(e) => setTedarikciCariId(e.target.value)}
                  className="w-full bg-[#0a0e13] border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-orange-400"
                >
                  <option value="" disabled>Tedarikçi Seçiniz...</option>
                  {filteredTedarikciler.map((c) => (
                    <option key={c.id} value={c.id}>
                      [{c.tur === 'tedarikci' ? 'TEDARİKÇİ' : 'CARİ'}] {c.unvan} ({formatCurrency(c.bakiye)})
                    </option>
                  ))}
                </select>
                {selectedTedarikci && (
                  <div className="p-2 rounded-lg bg-black/40 text-[11px] flex justify-between items-center border border-white/5">
                    <span className="text-gray-300 truncate max-w-[140px]">{selectedTedarikci.unvan}</span>
                    <span className="font-bold text-orange-400">{formatCurrency(selectedTedarikci.bakiye)}</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : (
          /* STANDART CARİ SEÇİMİ */
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-bold text-gray-200 uppercase tracking-wider">
                Cari Hesap Seçimi *
              </label>
              <span className="text-[11px] text-gray-400">
                {tip === 'tahsilat' ? 'Önce Alıcılar listelenir' : 'Önce Tedarikçiler listelenir'}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
              <div className="relative">
                <Search className="w-4 h-4 absolute left-3 top-3 text-gray-400" />
                <input
                  type="text"
                  value={cariSearch}
                  onChange={(e) => setCariSearch(e.target.value)}
                  placeholder="Cari ara (unvan, VKN)..."
                  className="w-full bg-[#0a0e13] border border-white/10 rounded-xl pl-9 pr-3 py-2 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-teal-400"
                />
              </div>

              <select
                required
                value={cariId}
                onChange={(e) => setCariId(e.target.value)}
                className="w-full bg-[#0a0e13] border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-teal-400"
              >
                <option value="" disabled>
                  Cari Seçiniz...
                </option>
                {filteredCariler.map((c) => (
                  <option key={c.id} value={c.id}>
                    [{c.tur === 'alici' ? 'ALICI' : 'TEDARİKÇİ'}] {c.unvan} ({formatCurrency(c.bakiye)})
                  </option>
                ))}
              </select>
            </div>

            {selectedCari && (
              <div className="p-3 rounded-xl bg-black/40 border border-white/[0.05] flex items-center justify-between text-xs">
                <div>
                  <span className="text-white font-bold">{selectedCari.unvan}</span>
                  <span className="text-gray-400 ml-2 font-mono">{selectedCari.vergi_tc_no || 'VKN yok'}</span>
                </div>
                <div className="text-right">
                  <span className="text-gray-400 mr-2 text-[11px]">Mevcut Bakiye:</span>
                  <span
                    className={`font-bold ${
                      Number(selectedCari.bakiye) > 0
                        ? 'text-teal-400'
                        : Number(selectedCari.bakiye) < 0
                        ? 'text-red-400'
                        : 'text-gray-400'
                    }`}
                  >
                    {formatCurrency(selectedCari.bakiye)}
                  </span>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ÖDEME TÜRÜ SEGMENT BUTONLAR (Çapraz ödemede sabit Kredi Kartıdır) */}
        {!isCapraz && (
          <div>
            <label className="block text-xs font-bold text-gray-200 uppercase tracking-wider mb-2">
              Ödeme Türü *
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
              <button
                type="button"
                onClick={() => {
                  setIsKarma(false);
                  setTur('nakit');
                }}
                className={`p-3 rounded-xl border flex flex-col items-center gap-1.5 transition ${
                  !isKarma && tur === 'nakit'
                    ? 'bg-teal-400 text-[#0a0e13] border-teal-400 font-bold shadow-md'
                    : 'bg-[#0a0e13] border-white/10 text-gray-300 hover:text-white hover:border-white/20'
                }`}
              >
                <Banknote className="w-5 h-5" />
                <span className="text-xs">Nakit</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setIsKarma(false);
                  setTur('kredi_karti');
                }}
                className={`p-3 rounded-xl border flex flex-col items-center gap-1.5 transition ${
                  !isKarma && tur === 'kredi_karti'
                    ? 'bg-teal-400 text-[#0a0e13] border-teal-400 font-bold shadow-md'
                    : 'bg-[#0a0e13] border-white/10 text-gray-300 hover:text-white hover:border-white/20'
                }`}
              >
                <CreditCard className="w-5 h-5" />
                <span className="text-xs">Kredi Kartı</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setIsKarma(false);
                  setTur('cek');
                }}
                className={`p-3 rounded-xl border flex flex-col items-center gap-1.5 transition ${
                  !isKarma && tur === 'cek'
                    ? 'bg-teal-400 text-[#0a0e13] border-teal-400 font-bold shadow-md'
                    : 'bg-[#0a0e13] border-white/10 text-gray-300 hover:text-white hover:border-white/20'
                }`}
              >
                <FileCheck className="w-5 h-5" />
                <span className="text-xs">Çek</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setIsKarma(false);
                  setTur('senet');
                }}
                className={`p-3 rounded-xl border flex flex-col items-center gap-1.5 transition ${
                  !isKarma && tur === 'senet'
                    ? 'bg-teal-400 text-[#0a0e13] border-teal-400 font-bold shadow-md'
                    : 'bg-[#0a0e13] border-white/10 text-gray-300 hover:text-white hover:border-white/20'
                }`}
              >
                <FileText className="w-5 h-5" />
                <span className="text-xs">Senet</span>
              </button>

              <button
                type="button"
                onClick={() => setIsKarma(true)}
                className={`col-span-2 sm:col-span-1 p-3 rounded-xl border flex flex-col items-center justify-center gap-1.5 transition ${
                  isKarma
                    ? 'bg-gradient-to-br from-teal-400 to-cyan-300 text-[#0a0e13] border-teal-300 font-bold shadow-[0_0_20px_rgba(45,212,191,0.35)]'
                    : 'bg-[#0a0e13] border-teal-500/30 text-teal-300 hover:text-white hover:border-teal-400'
                }`}
              >
                <Layers className="w-5 h-5" />
                <span className="text-xs font-bold">Karma / Çoklu</span>
              </button>
            </div>
          </div>
        )}

        {/* KARMA (ÇOKLU ÖDEME TÜRÜ) BÖLÜMÜ */}
        {isKarma && !isCapraz && (
          <>
            <div>
              <label className="block text-xs font-bold text-gray-200 uppercase tracking-wider mb-1.5">
                İşlem Tarihi (GG.AA.YYYY) *
              </label>
              <div className="relative flex items-center max-w-sm">
                <input
                  type="text"
                  inputMode="numeric"
                  required
                  value={tarihDisplay}
                  onChange={(e) => handleTarihChange(e.target.value)}
                  placeholder="Örn: 07.11.2026"
                  maxLength={10}
                  className="w-full bg-[#0a0e13] border border-white/10 rounded-xl pl-4 pr-12 py-3 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-teal-400 focus:ring-1 focus:ring-teal-400 font-mono tracking-wider"
                />
                <button
                  type="button"
                  onClick={() => {
                    if (tarihPickerRef.current) {
                      if (typeof (tarihPickerRef.current as any).showPicker === 'function') {
                        (tarihPickerRef.current as any).showPicker();
                      } else {
                        tarihPickerRef.current.click();
                      }
                    }
                  }}
                  className="absolute right-2 p-2 rounded-lg text-teal-400 hover:text-teal-300 hover:bg-white/10 transition active:scale-95"
                  title="Takvimi Aç"
                >
                  <Calendar className="w-5 h-5" />
                </button>
                <input
                  ref={tarihPickerRef}
                  type="date"
                  tabIndex={-1}
                  value={tarih}
                  onChange={(e) => handleTarihPickerChange(e.target.value)}
                  className="sr-only opacity-0 absolute pointer-events-none"
                />
              </div>
            </div>

            <KarmaPaymentSection
              nakit={karmaNakit}
              onChangeNakit={setKarmaNakit}
              kart={karmaKart}
              onChangeKart={setKarmaKart}
              cekler={karmaCekler}
              onChangeCekler={setKarmaCekler}
              senetler={karmaSenetler}
              onChangeSenetler={setKarmaSenetler}
              saveMode={karmaSaveMode}
              onChangeSaveMode={setKarmaSaveMode}
              isEditing={isEditing}
              exchangeRates={exchangeRates}
              posConfig={posConfig}
              posLinkGenerated={posLinkGenerated}
              onCreatePosLinkForKarma={handleCreatePosLinkForKarma}
              onSendPosLinkWhatsApp={() => {
                if (posLinkGenerated) {
                  openWhatsApp(selectedCari?.telefon, posLinkGenerated.message);
                }
              }}
            />
          </>
        )}

        {/* KREDİ KARTI VEYA ÇAPRAZ ÖDEME İÇİN BANKA / POS / SLİP DETAYLARI */}
        {!isKarma && (tur === 'kredi_karti' || isCapraz) && (
          <div className="p-4 rounded-xl bg-black/30 border border-teal-500/20 space-y-3">
            <div className="flex items-center justify-between pb-2 border-b border-white/[0.05]">
              <div className="flex items-center gap-2">
                <CreditCard className="w-4 h-4 text-teal-400" />
                <span className="font-bold text-teal-300 text-xs uppercase tracking-wider">
                  Kredi Kartı / POS Bilgileri
                </span>
              </div>
              {posConfig.enabled && posConfig.provider !== 'none' && (
                <span className="text-[10px] font-bold text-teal-400 bg-teal-500/10 px-2 py-0.5 rounded-full border border-teal-500/20">
                  {posConfig.provider.toUpperCase()} Sanal POS Aktif
                </span>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-semibold text-gray-300 mb-1">
                  Banka / POS Cihazı / Altyapı
                </label>
                <input
                  type="text"
                  value={bankaAdi}
                  onChange={(e) => setBankaAdi(e.target.value)}
                  placeholder={
                    posConfig.enabled && posConfig.provider !== 'none'
                      ? `${posConfig.provider.toUpperCase()} Sanal POS`
                      : 'Örn: Garanti POS, Yapı Kredi, vb.'
                  }
                  className="w-full bg-[#0a0e13] border border-white/10 rounded-xl px-3 py-2 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-teal-400"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-gray-300 mb-1">
                  Slip No / Otorizasyon / Kart Ref
                </label>
                <input
                  type="text"
                  value={slipNo}
                  onChange={(e) => setSlipNo(e.target.value)}
                  placeholder="Örn: 984521 veya Son 4 Hane (4521)"
                  className="w-full bg-[#0a0e13] border border-white/10 rounded-xl px-3 py-2 text-xs text-white font-mono placeholder-gray-500 focus:outline-none focus:border-teal-400"
                />
              </div>
            </div>

            {/* SANAL POS ÖDEME LİNKİ BUTONU */}
            {posConfig.enabled && posConfig.provider !== 'none' && (
              <div className="pt-2 border-t border-white/[0.05] flex flex-col sm:flex-row items-center justify-between gap-2">
                <span className="text-[11px] text-gray-400">
                  Müşteriniz uzaktaysa kredi kartı ile ödemesi için güvenli link gönderebilirsiniz:
                </span>
                <button
                  type="button"
                  onClick={handleCreatePosLink}
                  className="px-3 py-1.5 rounded-lg bg-teal-400/20 text-teal-300 hover:bg-teal-400/30 border border-teal-400/30 text-xs font-bold flex items-center gap-1.5 transition whitespace-nowrap"
                >
                  <Share2 className="w-3.5 h-3.5" />
                  <span>Sanal POS Linki Üret</span>
                </button>
              </div>
            )}

            {/* OLUŞTURULAN LİNK GÖSTERİMİ */}
            {posLinkGenerated && (
              <div className="p-3 rounded-xl bg-teal-500/10 border border-teal-500/30 space-y-2 mt-2">
                <div className="text-[11px] text-gray-300 font-mono whitespace-pre-line bg-[#0a0e13] p-2.5 rounded border border-white/5">
                  {posLinkGenerated.message}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(posLinkGenerated.message);
                      alert('Ödeme linki metni kopyalandı!');
                    }}
                    className="px-3 py-1 rounded bg-teal-400/20 text-teal-300 text-xs font-bold hover:bg-teal-400/30 transition flex items-center gap-1"
                  >
                    <Copy className="w-3.5 h-3.5" />
                    <span>Kopyala</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const customerPhone = selectedCari?.telefon;
                      openWhatsApp(customerPhone, posLinkGenerated.message);
                    }}
                    className="px-3 py-1 rounded bg-emerald-500/20 text-emerald-300 text-xs font-bold hover:bg-emerald-500/30 transition flex items-center gap-1"
                  >
                    <Share2 className="w-3.5 h-3.5" />
                    <span>WhatsApp ile Gönder</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* PARA BİRİMİ SEÇİCİ (Çek/Senet normal girişte her çekin kendi tutarı ve para birimi girilir) */}
        {!isKarma && !(isCekSenet && !isCiro && !isCapraz) && (
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-bold text-gray-200 uppercase tracking-wider flex items-center gap-1.5">
                <DollarSign className="w-3.5 h-3.5 text-teal-400" />
                <span>Para Birimi</span>
              </label>
              {exchangeRates && (
                <span className="text-[10px] text-gray-400 flex items-center gap-1">
                  <TrendingUp className="w-3 h-3 text-teal-400" />
                  <span>TCMB: USD {exchangeRates.USD} ₺ | EUR {exchangeRates.EUR} ₺</span>
                </span>
              )}
            </div>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => handleCurrencyChange('TRY')}
                className={`py-2 px-3 rounded-xl border text-xs font-bold transition flex items-center justify-center gap-1.5 ${
                  paraBirimi === 'TRY'
                    ? 'bg-teal-400 text-[#0a0e13] border-teal-400 shadow-md'
                    : 'bg-[#0a0e13] border-white/10 text-gray-300 hover:text-white'
                }`}
              >
                <span>₺ TRY</span>
                <span className="text-[10px] font-normal opacity-80">(Türk Lirası)</span>
              </button>
              <button
                type="button"
                onClick={() => handleCurrencyChange('USD')}
                className={`py-2 px-3 rounded-xl border text-xs font-bold transition flex items-center justify-center gap-1.5 ${
                  paraBirimi === 'USD'
                    ? 'bg-teal-400 text-[#0a0e13] border-teal-400 shadow-md'
                    : 'bg-[#0a0e13] border-white/10 text-gray-300 hover:text-white'
                }`}
              >
                <span>$ USD</span>
                <span className="text-[10px] font-normal opacity-80">(Dolar)</span>
              </button>
              <button
                type="button"
                onClick={() => handleCurrencyChange('EUR')}
                className={`py-2 px-3 rounded-xl border text-xs font-bold transition flex items-center justify-center gap-1.5 ${
                  paraBirimi === 'EUR'
                    ? 'bg-teal-400 text-[#0a0e13] border-teal-400 shadow-md'
                    : 'bg-[#0a0e13] border-white/10 text-gray-300 hover:text-white'
                }`}
              >
                <span>€ EUR</span>
                <span className="text-[10px] font-normal opacity-80">(Euro)</span>
              </button>
            </div>
          </div>
        )}

        {/* DÖVİZLİ İŞLEM DETAYLARI (USD VEYA EUR İSE - Nakit/Kart için) */}
        {!isKarma && !(isCekSenet && !isCiro && !isCapraz) && paraBirimi !== 'TRY' && (
          <div className="p-3.5 rounded-xl bg-teal-500/10 border border-teal-500/20 space-y-3">
            <div className="text-xs font-bold text-teal-400 flex items-center justify-between">
              <span>Dövizli Giriş ve Kur Bilgileri</span>
              <span className="text-[10px] font-normal text-gray-400">TCMB veya Serbest Kur</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-semibold text-gray-300 mb-1">
                  Döviz Tutarı ({paraBirimi === 'USD' ? '$' : '€'}) *
                </label>
                <div className="relative">
                  <input
                    type="text"
                    inputMode="decimal"
                    value={dovizTutari}
                    onChange={(e) => handleDovizTutariChange(e.target.value)}
                    placeholder="Örn: 1000"
                    className="w-full bg-[#0a0e13] border border-white/10 rounded-xl px-3 py-2 text-sm font-bold text-white placeholder-gray-500 focus:outline-none focus:border-teal-400 font-mono"
                  />
                  <span className="absolute right-3 top-2 text-teal-400 font-bold text-sm">
                    {paraBirimi === 'USD' ? '$' : '€'}
                  </span>
                </div>
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-gray-300 mb-1">
                  Döviz Kuru (₺) *
                </label>
                <div className="relative">
                  <input
                    type="text"
                    inputMode="decimal"
                    value={dovizKuru}
                    onChange={(e) => handleDovizKuruChange(e.target.value)}
                    placeholder="Örn: 38,45"
                    className="w-full bg-[#0a0e13] border border-white/10 rounded-xl px-3 py-2 text-sm font-bold text-white placeholder-gray-500 focus:outline-none focus:border-teal-400 font-mono"
                  />
                  <span className="absolute right-3 top-2 text-gray-400 font-bold text-xs">₺/Kur</span>
                </div>
              </div>
            </div>
            <div className="pt-2 border-t border-teal-500/20 flex items-center justify-between text-xs">
              <span className="text-gray-300">Hesaplanan Türk Lirası Karşılığı:</span>
              <span className="font-black text-teal-400 font-mono text-sm">
                {tutar ? `${tutar} ₺` : '0,00 ₺'}
              </span>
            </div>
          </div>
        )}

        {/* TUTAR VE TARİH */}
        {!isKarma && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {isCekSenet && !isCiro && !isCapraz ? (
            <div className="p-3 rounded-xl bg-teal-500/10 border border-teal-500/25 flex flex-col justify-center">
              <span className="text-[11px] font-bold text-teal-300 uppercase tracking-wider">
                Makbuz Toplamı (Otomatik)
              </span>
              <div className="text-xl font-black text-white font-mono mt-0.5">
                {formatCurrency(cekToplamTL)}
              </div>
              <span className="text-[10px] text-gray-400">
                Aşağıdaki {cekList.length} {tur === 'cek' ? 'çek' : 'senet'} tutarından otomatik toplanır
              </span>
            </div>
          ) : (
            <div>
              <label className="block text-xs font-bold text-gray-200 uppercase tracking-wider mb-1.5">
                İşlem Tutarı (₺) *
              </label>
              <div className="relative">
                <input
                  type="text"
                  inputMode="decimal"
                  required
                  value={tutar}
                  onChange={(e) => {
                    if (paraBirimi === 'TRY') setTutar(e.target.value);
                  }}
                  readOnly={paraBirimi !== 'TRY' || (isCiro && !!selectedPortfoyCek)}
                  placeholder="0,00"
                  className={`w-full bg-[#0a0e13] border border-white/10 rounded-xl px-4 py-3 text-lg font-bold text-white placeholder-gray-500 focus:outline-none focus:border-teal-400 focus:ring-1 focus:ring-teal-400 font-mono ${
                    paraBirimi !== 'TRY' || (isCiro && !!selectedPortfoyCek) ? 'bg-black/40 text-teal-300' : ''
                  }`}
                />
                <span className="absolute right-4 top-3.5 text-gray-400 font-bold text-sm">₺</span>
              </div>
            </div>
          )}

          <div>
            <label className="block text-xs font-bold text-gray-200 uppercase tracking-wider mb-1.5">
              İşlem Tarihi (GG.AA.YYYY) *
            </label>
            <div className="relative flex items-center">
              <input
                type="text"
                inputMode="numeric"
                required
                value={tarihDisplay}
                onChange={(e) => handleTarihChange(e.target.value)}
                placeholder="Örn: 07.11.2026"
                maxLength={10}
                className="w-full bg-[#0a0e13] border border-white/10 rounded-xl pl-4 pr-12 py-3 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-teal-400 focus:ring-1 focus:ring-teal-400 font-mono tracking-wider"
              />
              <button
                type="button"
                onClick={() => {
                  if (tarihPickerRef.current) {
                    if (typeof (tarihPickerRef.current as any).showPicker === 'function') {
                      (tarihPickerRef.current as any).showPicker();
                    } else {
                      tarihPickerRef.current.click();
                    }
                  }
                }}
                className="absolute right-2 p-2 rounded-lg text-teal-400 hover:text-teal-300 hover:bg-white/10 transition active:scale-95"
                title="Takvimi Aç"
              >
                <Calendar className="w-5 h-5" />
              </button>
              {/* Sadece takvim ikonuna basıldığında açılan takvim seçici */}
              <input
                ref={tarihPickerRef}
                type="date"
                tabIndex={-1}
                value={tarih}
                onChange={(e) => handleTarihPickerChange(e.target.value)}
                className="sr-only opacity-0 absolute pointer-events-none"
              />
            </div>
          </div>
        </div>
        )}

        {/* ÇEK VEYA SENET ALANLARI (isCekSenet kontrolü ile açılır) */}
        {isCekSenet && (
          <div className="p-4 rounded-xl bg-black/40 border border-teal-500/20 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="text-xs font-bold text-teal-400 uppercase tracking-wider flex items-center gap-2">
                <FileCheck className="w-4 h-4" />
                <span>{tur === 'cek' ? 'Çek Detay Bilgileri' : 'Senet Detay Bilgileri'}</span>
              </div>

              {/* CİRO SEÇENEĞİ TOGGLE */}
              <div className="flex rounded-lg bg-black/60 p-0.5 border border-white/[0.08] text-xs">
                <button
                  type="button"
                  onClick={handleClearCiro}
                  className={`py-1.5 px-3 rounded-md text-[11px] font-semibold transition ${
                    !isCiro ? 'bg-teal-400 text-[#0a0e13] font-bold shadow' : 'text-gray-400 hover:text-white'
                  }`}
                >
                  Normal Giriş
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setIsCiro(true);
                    if (!selectedPortfoyCek && portfoyCekleri.length > 0) {
                      setPortfoyModalOpen(true);
                    }
                  }}
                  className={`py-1.5 px-3 rounded-md text-[11px] font-semibold transition flex items-center gap-1.5 ${
                    isCiro ? 'bg-orange-400 text-[#0a0e13] font-bold shadow' : 'text-gray-400 hover:text-white'
                  }`}
                >
                  <Repeat className="w-3 h-3" />
                  <span>Elimizdeki Çeki Ciro Et</span>
                  <span className="text-[10px] px-1 rounded-full bg-black/20 font-bold">
                    {portfoyCekleri.length}
                  </span>
                </button>
              </div>
            </div>

            {/* CİRO EDİLECEK ÇEK SEÇİLMİŞSE GÖSTERİM KARTI */}
            {isCiro ? (
              selectedPortfoyCek ? (
                <div className="p-3.5 rounded-xl bg-teal-500/10 border border-teal-500/30 text-white space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-teal-400 flex items-center gap-1.5">
                      <CheckCircle2 className="w-4 h-4" />
                      Ciro Edilecek {tur === 'cek' ? 'Çek' : 'Senet'} Seçildi
                    </span>
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => setPortfoyModalOpen(true)}
                        className="text-[11px] text-teal-300 hover:text-teal-200 underline font-semibold"
                      >
                        Değiştir
                      </button>
                      <button
                        type="button"
                        onClick={handleClearCiro}
                        className="text-[11px] text-red-400 hover:text-red-300 underline font-semibold"
                      >
                        Cirodan Vazgeç
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs pt-1 border-t border-teal-500/20">
                    <div>
                      <span className="text-[10px] text-gray-400 block font-medium">Belge No:</span>
                      <span className="font-mono font-bold text-white text-xs">{selectedPortfoyCek.belge_no || '-'}</span>
                    </div>
                    <div>
                      <span className="text-[10px] text-gray-400 block font-medium">Asıl Borçlu / Keşideci:</span>
                      <span className="font-semibold text-white truncate block text-xs">{selectedPortfoyCek.cariler?.unvan || '-'}</span>
                    </div>
                    <div>
                      <span className="text-[10px] text-gray-400 block font-medium">Vade Tarihi:</span>
                      <span className="font-semibold text-teal-300 text-xs">{formatDate(selectedPortfoyCek.vade)}</span>
                    </div>
                    <div>
                      <span className="text-[10px] text-gray-400 block font-medium">Çek Tutarı:</span>
                      <span className="font-bold text-teal-400 font-mono text-sm">{formatCurrency(selectedPortfoyCek.tutar)}</span>
                    </div>
                  </div>
                  {selectedPortfoyCek.banka_adi && (
                    <div className="text-[11px] text-gray-400 pt-1 border-t border-teal-500/10">
                      <span className="text-gray-300 font-medium">Banka:</span> {selectedPortfoyCek.banka_adi}
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-2">
                  {portfoyCekleri.length === 0 ? (
                    <div className="p-4 rounded-xl bg-orange-500/10 border border-orange-500/30 text-orange-300 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <span>Portföyünüzde henüz ciro edilebilecek tahsil edilmiş müşteri {tur === 'cek' ? 'çeki' : 'senedi'} bulunmuyor.</span>
                      <button
                        type="button"
                        onClick={handleClearCiro}
                        className="px-3 py-1.5 rounded-lg bg-orange-500/20 text-orange-200 text-xs font-bold hover:bg-orange-500/30 self-start sm:self-auto"
                      >
                        Normal Girişe Dön
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setPortfoyModalOpen(true)}
                      className="w-full py-4 px-4 rounded-xl border-2 border-dashed border-orange-400/40 hover:border-orange-400 bg-orange-500/5 hover:bg-orange-500/10 text-orange-300 font-bold text-xs flex flex-col items-center justify-center gap-1.5 transition"
                    >
                      <Layers className="w-6 h-6 text-orange-400" />
                      <span className="text-sm">Portföyden {tur === 'cek' ? 'Çek' : 'Senet'} Seçin</span>
                      <span className="text-[11px] text-gray-400 font-normal">
                        Elimizde toplam {portfoyCekleri.length} adet ciro edilebilir {tur === 'cek' ? 'çek' : 'senet'} bulunuyor. Seçmek için tıklayın.
                      </span>
                    </button>
                  )}
                </div>
              )
            ) : (
              <div className="space-y-3">
                {/* HER ÇEK İÇİN AYRI KART (No, Vade, Banka, Ciro/Keşide, Tutar, Para Birimi) */}
                {cekList.map((cek, idx) => {
                  const defaultKur =
                    cek.paraBirimi === 'USD'
                      ? (exchangeRates?.USD || 38.45).toString().replace('.', ',')
                      : (exchangeRates?.EUR || 41.2).toString().replace('.', ',');
                  const tlEq = getCheckTlEquivalent(cek);

                  return (
                    <div
                      key={cek.id}
                      className="p-3.5 rounded-xl bg-[#0a0e13] border border-white/10 space-y-3"
                    >
                      <div className="flex items-center justify-between border-b border-white/[0.06] pb-2">
                        <div className="flex items-center gap-2">
                          <span className="px-2 py-0.5 rounded-md bg-teal-500/20 text-teal-300 font-bold text-[11px]">
                            {idx + 1}. {tur === 'cek' ? 'Çek' : 'Senet'}
                          </span>
                          {cek.tutar && parseAmountInput(cek.tutar) > 0 && (
                            <span className="text-[11px] font-mono text-gray-300">
                              {parseAmountInput(cek.tutar).toLocaleString('tr-TR', {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              })}{' '}
                              {cek.paraBirimi === 'TRY' ? 'TL' : cek.paraBirimi}
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-2">
                          {/* Keşide / Ciro Seçimi */}
                          <div className="flex rounded-lg bg-black/60 p-0.5 border border-white/10 text-[10px]">
                            <button
                              type="button"
                              onClick={() => updateCekRow(cek.id, { durum: 'keside' })}
                              className={`px-2.5 py-1 rounded font-bold transition ${
                                cek.durum === 'keside'
                                  ? 'bg-emerald-500 text-slate-950'
                                  : 'text-gray-400 hover:text-white'
                              }`}
                            >
                              Keşide
                            </button>
                            <button
                              type="button"
                              onClick={() => updateCekRow(cek.id, { durum: 'ciro' })}
                              className={`px-2.5 py-1 rounded font-bold transition ${
                                cek.durum === 'ciro'
                                  ? 'bg-amber-400 text-slate-950'
                                  : 'text-gray-400 hover:text-white'
                              }`}
                            >
                              Ciro
                            </button>
                          </div>

                          {cekList.length > 1 && (
                            <button
                              type="button"
                              onClick={() => removeCekRow(cek.id)}
                              className="p-1.5 rounded-lg text-red-400 hover:text-red-300 hover:bg-red-500/15 transition"
                              title="Bu Çeki Kaldır"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Satır 1: Belge No, Vade, Banka */}
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <div>
                          <label className="block text-[11px] font-semibold text-gray-300 mb-1">
                            Belge No / {tur === 'cek' ? 'Çek No' : 'Senet No'}
                          </label>
                          <input
                            type="text"
                            value={cek.no}
                            onChange={(e) => updateCekRow(cek.id, { no: e.target.value })}
                            placeholder="Örn: CK-98421"
                            className="w-full bg-[#111820] border border-white/10 rounded-xl px-3 py-2 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-teal-400 font-mono"
                          />
                        </div>

                        <div>
                          <label className="block text-[11px] font-semibold text-gray-300 mb-1">
                            Vade Tarihi (GG.AA.YYYY) *
                          </label>
                          <div className="relative flex items-center">
                            <input
                              type="text"
                              inputMode="numeric"
                              required={isCekSenet && !isCiro}
                              value={cek.vade}
                              onChange={(e) => handleCekVadeChange(cek.id, e.target.value)}
                              placeholder="Örn: 15.12.2026"
                              maxLength={10}
                              className="w-full bg-[#111820] border border-white/10 rounded-xl pl-3 pr-10 py-2 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-teal-400 font-mono tracking-wider"
                            />
                            <button
                              type="button"
                              onClick={() => {
                                const refEl = cekVadeRefs.current[cek.id];
                                if (refEl) {
                                  if (typeof (refEl as any).showPicker === 'function') {
                                    (refEl as any).showPicker();
                                  } else {
                                    refEl.click();
                                  }
                                }
                              }}
                              className="absolute right-1.5 p-1.5 rounded-lg text-teal-400 hover:text-teal-300 hover:bg-white/10 transition active:scale-95"
                              title="Takvimi Aç"
                            >
                              <Calendar className="w-4 h-4" />
                            </button>
                            <input
                              ref={(el) => {
                                cekVadeRefs.current[cek.id] = el;
                              }}
                              type="date"
                              tabIndex={-1}
                              value={parseVadeToIso(cek.vade) || ''}
                              onChange={(e) => {
                                if (e.target.value) {
                                  updateCekRow(cek.id, { vade: formatIsoToDisplay(e.target.value) });
                                }
                              }}
                              className="sr-only opacity-0 absolute pointer-events-none"
                            />
                          </div>
                          <div className="flex items-center gap-1 mt-1.5 overflow-x-auto">
                            {[
                              { label: 'Bugün', days: 0 },
                              { label: '30G', days: 30 },
                              { label: '60G', days: 60 },
                              { label: '90G', days: 90 },
                              { label: '120G', days: 120 },
                            ].map((q) => (
                              <button
                                key={q.days}
                                type="button"
                                onClick={() => setCekQuickVadeDays(cek.id, q.days)}
                                className="px-2 py-0.5 rounded bg-white/5 hover:bg-teal-500/20 text-gray-300 hover:text-teal-300 text-[10px] font-semibold border border-white/10 transition shrink-0"
                              >
                                {q.label}
                              </button>
                            ))}
                          </div>
                        </div>

                        <div>
                          <label className="block text-[11px] font-semibold text-gray-300 mb-1">
                            Banka Adı / Şube
                          </label>
                          <input
                            type="text"
                            value={cek.banka}
                            onChange={(e) => updateCekRow(cek.id, { banka: e.target.value })}
                            placeholder="Örn: Garanti BBVA"
                            className="w-full bg-[#111820] border border-white/10 rounded-xl px-3 py-2 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-teal-400"
                          />
                        </div>
                      </div>

                      {/* Satır 2: Çek Tutarı & Para Birimi (+ dövizse Kur) */}
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
                        <div>
                          <label className="block text-[11px] font-semibold text-teal-300 mb-1">
                            {tur === 'cek' ? 'Çek Tutarı *' : 'Senet Tutarı *'}
                          </label>
                          <input
                            type="text"
                            inputMode="decimal"
                            required={isCekSenet && !isCiro}
                            value={cek.tutar}
                            onChange={(e) => updateCekRow(cek.id, { tutar: e.target.value })}
                            placeholder="Örn: 50.000,00"
                            className="w-full bg-[#111820] border border-teal-500/30 rounded-xl px-3 py-2 text-sm font-bold text-white placeholder-gray-500 focus:outline-none focus:border-teal-400 font-mono"
                          />
                        </div>

                        <div>
                          <label className="block text-[11px] font-semibold text-gray-300 mb-1">
                            Para Birimi
                          </label>
                          <div className="grid grid-cols-3 gap-1.5">
                            {(['TRY', 'USD', 'EUR'] as const).map((curr) => (
                              <button
                                key={curr}
                                type="button"
                                onClick={() =>
                                  updateCekRow(cek.id, {
                                    paraBirimi: curr,
                                    kur:
                                      curr === 'TRY'
                                        ? ''
                                        : cek.kur ||
                                          (curr === 'USD'
                                            ? (exchangeRates?.USD || 38.45).toString().replace('.', ',')
                                            : (exchangeRates?.EUR || 41.2).toString().replace('.', ',')),
                                  })
                                }
                                className={`py-2 rounded-xl border text-[11px] font-bold transition ${
                                  cek.paraBirimi === curr
                                    ? 'bg-teal-400 text-slate-950 border-teal-400'
                                    : 'bg-[#111820] border-white/10 text-gray-300 hover:text-white'
                                }`}
                              >
                                {curr === 'TRY' ? '₺ TL' : curr === 'USD' ? '$ USD' : '€ EUR'}
                              </button>
                            ))}
                          </div>
                        </div>

                        {cek.paraBirimi !== 'TRY' ? (
                          <div>
                            <label className="block text-[11px] font-semibold text-gray-300 mb-1">
                              Kur (₺) • TL: {formatCurrency(tlEq)}
                            </label>
                            <input
                              type="text"
                              inputMode="decimal"
                              value={cek.kur || defaultKur}
                              onChange={(e) => updateCekRow(cek.id, { kur: e.target.value })}
                              placeholder={defaultKur}
                              className="w-full bg-[#111820] border border-white/10 rounded-xl px-3 py-2 text-xs font-bold text-teal-300 focus:outline-none focus:border-teal-400 font-mono"
                            />
                          </div>
                        ) : (
                          <div className="hidden sm:flex items-end pb-2 text-[11px] text-gray-400 font-mono">
                            Format: {cek.no || '...'} nl. {cek.vade || '...'} vd. {cek.durum}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}

                {/* + YENİ ÇEK EKLE & OTOMATİK TOPLAM ÇUBUĞU */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
                  <button
                    type="button"
                    onClick={addCekRow}
                    className="px-4 py-2.5 rounded-xl bg-teal-500/20 hover:bg-teal-500/30 text-teal-300 border border-teal-500/40 text-xs font-bold flex items-center justify-center gap-2 transition active:scale-95"
                  >
                    <Plus className="w-4 h-4" />
                    <span>
                      + {cekList.length + 1}. {tur === 'cek' ? 'Çeki Ekle' : 'Senedi Ekle'}
                    </span>
                  </button>

                  <div className="px-4 py-2.5 rounded-xl bg-teal-500/10 border border-teal-500/30 flex items-center justify-between sm:justify-end gap-4">
                    <span className="text-xs text-gray-300 font-semibold">
                      {cekList.length} Adet {tur === 'cek' ? 'Çek' : 'Senet'} Toplamı:
                    </span>
                    <span className="text-base font-black text-teal-400 font-mono">
                      {formatCurrency(cekToplamTL)}
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* AÇIKLAMA */}
        <div>
          <label className="block text-xs font-bold text-gray-200 uppercase tracking-wider mb-1.5">
            Açıklama / Not
          </label>
          <input
            type="text"
            value={aciklama}
            onChange={(e) => setAciklama(e.target.value)}
            placeholder="İşleme ait not veya açıklama ekleyin..."
            className="w-full bg-[#0a0e13] border border-white/10 rounded-xl px-4 py-2.5 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-teal-400 focus:ring-1 focus:ring-teal-400"
          />
        </div>

        {/* BUTONLAR */}
        <div className="pt-2 flex flex-col sm:flex-row sm:items-center justify-end gap-3 border-t border-white/[0.06]">
          <button
            type="button"
            onClick={onCancel}
            className="px-5 py-2.5 rounded-xl border border-white/10 text-gray-300 hover:bg-white/5 font-semibold text-xs transition"
          >
            Vazgeç
          </button>
          <button
            type="submit"
            disabled={loading || (isKarma && !isCapraz && karmaGrandTotal <= 0)}
            className={`px-6 py-2.5 rounded-xl font-bold text-xs transition flex items-center justify-center gap-2 shadow-lg disabled:opacity-50 ${
              isCapraz
                ? 'bg-purple-500 hover:bg-purple-400 text-white shadow-[0_0_20px_rgba(168,85,247,0.3)]'
                : tip === 'tahsilat'
                ? 'bg-teal-400 hover:bg-teal-300 text-[#0a0e13] shadow-[0_0_20px_rgba(45,212,191,0.25)]'
                : 'bg-orange-400 hover:bg-orange-300 text-[#0a0e13] shadow-[0_0_20px_rgba(251,146,60,0.25)]'
            }`}
          >
            {loading ? (
              <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
            ) : (
              <>
                <CheckCircle2 className="w-4 h-4" />
                <span>
                  {isKarma && !isCapraz
                    ? isEditing
                      ? `Karma Makbuzu Güncelle (${formatCurrency(karmaGrandTotal)})`
                      : `Karma Makbuzu Kaydet (${formatCurrency(karmaGrandTotal)})`
                    : isEditing
                    ? 'Makbuzu Güncelle'
                    : isCapraz
                    ? 'Çapraz Ödeme Makbuzlarını Kaydet'
                    : tip === 'tahsilat'
                    ? 'Tahsilat Makbuzunu Kaydet'
                    : 'Tediye Makbuzunu Kaydet'}
                </span>
              </>
            )}
          </button>
        </div>
      </form>

      {/* PORTFÖYDEN ÇEK/SENET SEÇME MODALI */}
      {portfoyModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in">
          <div className="bg-[#111820] border border-white/10 rounded-2xl w-full max-w-xl max-h-[85vh] flex flex-col shadow-2xl overflow-hidden">
            {/* MODAL BAŞLIK */}
            <div className="p-4 border-b border-white/10 flex items-center justify-between bg-black/40">
              <div className="flex items-center gap-2">
                <Layers className="w-5 h-5 text-orange-400" />
                <h3 className="font-bold text-sm text-white">
                  Portföydeki {tur === 'cek' ? 'Çekler' : 'Senetler'} (Ciro İçin Seçin)
                </h3>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-orange-500/20 text-orange-300">
                  {portfoyCekleri.length} Adet
                </span>
              </div>
              <button
                type="button"
                onClick={() => setPortfoyModalOpen(false)}
                className="p-1 rounded-lg text-gray-400 hover:text-white hover:bg-white/10 transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* ARAMA ÇUBUĞU */}
            <div className="p-3 border-b border-white/[0.06] bg-[#0d1319]">
              <div className="relative">
                <Search className="w-4 h-4 text-gray-400 absolute left-3 top-2.5" />
                <input
                  type="text"
                  value={portfoySearch}
                  onChange={(e) => setPortfoySearch(e.target.value)}
                  placeholder="Belge no, müşteri unvanı veya banka ara..."
                  className="w-full bg-[#0a0e13] border border-white/10 rounded-xl pl-9 pr-3 py-2 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-orange-400"
                />
              </div>
            </div>

            {/* ÇEK LİSTESİ */}
            <div className="flex-1 overflow-y-auto p-3 divide-y divide-white/[0.04] space-y-2">
              {(() => {
                const q = portfoySearch.toLowerCase().trim();
                const filtered = portfoyCekleri.filter(
                  (c) =>
                    !q ||
                    c.belge_no?.toLowerCase().includes(q) ||
                    c.cariler?.unvan?.toLowerCase().includes(q) ||
                    c.banka_adi?.toLowerCase().includes(q)
                );

                if (filtered.length === 0) {
                  return (
                    <div className="p-8 text-center text-xs text-gray-400">
                      {portfoySearch
                        ? 'Aramanıza uygun ciro edilebilir çek/senet bulunamadı.'
                        : 'Portföyünüzde henüz ciro edilebilecek tahsil edilmiş müşteri çeki/senedi bulunmuyor.'}
                    </div>
                  );
                }

                return filtered.map((c) => (
                  <div
                    key={c.id}
                    onClick={() => handleSelectPortfoyCek(c)}
                    className="p-3 rounded-xl bg-black/40 hover:bg-orange-500/10 border border-white/[0.05] hover:border-orange-500/40 transition cursor-pointer group flex items-center justify-between gap-3"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold text-orange-400 text-xs">
                          {c.belge_no || 'Belge No Yok'}
                        </span>
                        <span className="text-gray-400 text-[10px]">•</span>
                        <span className="font-semibold text-white text-xs truncate max-w-[200px]">
                          {c.cariler?.unvan || 'Müşteri Bilinmiyor'}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 text-[11px] text-gray-400">
                        {c.banka_adi && <span>{c.banka_adi} • </span>}
                        <span>
                          Vade: <strong className="text-gray-200">{formatDate(c.vade)}</strong>
                        </span>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="font-mono font-black text-white group-hover:text-orange-400 text-sm">
                        {formatCurrency(c.tutar)}
                      </div>
                      <span className="text-[10px] font-bold text-orange-400 group-hover:underline">
                        Bu Çeki Ciro Et →
                      </span>
                    </div>
                  </div>
                ));
              })()}
            </div>

            {/* MODAL ALT BİLGİ */}
            <div className="p-3 bg-black/40 border-t border-white/10 flex items-center justify-between text-xs text-gray-400">
              <span>Seçilen çek tediye makbuzuna ciro olarak bağlanacaktır.</span>
              <button
                type="button"
                onClick={() => setPortfoyModalOpen(false)}
                className="px-3 py-1.5 rounded-lg border border-white/10 hover:bg-white/10 text-white font-semibold text-xs"
              >
                Kapat
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
