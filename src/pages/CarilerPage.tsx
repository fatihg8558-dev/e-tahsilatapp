import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { supabase, handleSupabaseError } from '../lib/supabase';
import { Cari, CariTur, Islem, Fatura } from '../types/database';
import { formatCurrency, formatDate } from '../lib/formatters';
import {
  Users,
  Search,
  Plus,
  Edit2,
  Trash2,
  Phone,
  Mail,
  FileText,
  ArrowDownLeft,
  ArrowUpRight,
  ReceiptText,
  AlertCircle,
  X,
  FileSpreadsheet,
  CheckCircle2,
  ExternalLink,
  Printer,
  Download,
  Upload,
} from 'lucide-react';
import { exportToExcel, printPdfReport } from '../lib/exportService';
import { UblImportModal } from '../components/cari/UblImportModal';

interface CarilerPageProps {
  onNavigate: (tab: string, state?: unknown) => void;
  openNewModalInitially?: boolean;
  onOpenMakbuz?: (islem: Islem) => void;
  refreshKey?: number;
}

export const CarilerPage: React.FC<CarilerPageProps> = ({
  onNavigate,
  openNewModalInitially = false,
  onOpenMakbuz,
  refreshKey = 0,
}) => {
  const { firma } = useAuth();
  const [cariler, setCariler] = useState<Cari[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [turFilter, setTurFilter] = useState<'all' | CariTur>('all');
  const [error, setError] = useState<string | null>(null);

  // Modal States
  const [isModalOpen, setIsModalOpen] = useState(openNewModalInitially);
  const [isUblModalOpen, setIsUblModalOpen] = useState(false);
  const [editingCari, setEditingCari] = useState<Cari | null>(null);
  const [selectedCariForDetail, setSelectedCariForDetail] = useState<Cari | null>(null);
  const [detailMovements, setDetailMovements] = useState<Array<Islem | (Fatura & { tip: string })>>([]);
  const [loadingDetail, setLoadingDetail] = useState(false);

  // Form Fields
  const [formUnvan, setFormUnvan] = useState('');
  const [formVergiTcNo, setFormVergiTcNo] = useState('');
  const [formTelefon, setFormTelefon] = useState('');
  const [formEmail, setFormEmail] = useState('');
  const [formTur, setFormTur] = useState<CariTur>('alici');
  const [formLoading, setFormLoading] = useState(false);

  // Delete State
  const [cariToDelete, setCariToDelete] = useState<Cari | null>(null);

  const fetchCariler = async () => {
    if (!firma?.id) return;
    try {
      setLoading(true);
      setError(null);
      const { data, error: fetchErr } = await supabase
        .from('cariler')
        .select('*')
        .eq('firma_id', firma.id)
        .order('unvan', { ascending: true });

      if (fetchErr) throw fetchErr;
      setCariler((data as Cari[]) || []);
    } catch (err: unknown) {
      setError(handleSupabaseError(err, 'Cariler yüklenirken hata oluştu.'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCariler();
    if (selectedCariForDetail) {
      openDetail(selectedCariForDetail);
    }
  }, [firma?.id, refreshKey]);

  const openAddModal = () => {
    setEditingCari(null);
    setFormUnvan('');
    setFormVergiTcNo('');
    setFormTelefon('');
    setFormEmail('');
    setFormTur('alici');
    setIsModalOpen(true);
  };

  const openEditModal = (cari: Cari) => {
    setEditingCari(cari);
    setFormUnvan(cari.unvan);
    setFormVergiTcNo(cari.vergi_tc_no || '');
    setFormTelefon(cari.telefon || '');
    setFormEmail(cari.email || '');
    setFormTur(cari.tur);
    setIsModalOpen(true);
  };

  const handleSaveCari = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firma?.id) return;
    if (!formUnvan.trim()) {
      setError('Cari unvanı zorunludur.');
      return;
    }

    setFormLoading(true);
    setError(null);

    try {
      if (editingCari) {
        // Düzenle (bakiye güncellenmez!)
        const { error: updateErr } = await supabase
          .from('cariler')
          .update({
            unvan: formUnvan.trim(),
            vergi_tc_no: formVergiTcNo.trim() || null,
            telefon: formTelefon.trim() || null,
            email: formEmail.trim() || null,
            tur: formTur,
          })
          .eq('id', editingCari.id)
          .eq('firma_id', firma.id);

        if (updateErr) throw updateErr;
      } else {
        // Ekle (bakiye 0 başlar, trigger yönetir)
        const { error: insertErr } = await supabase
          .from('cariler')
          .insert({
            firma_id: firma.id,
            unvan: formUnvan.trim(),
            vergi_tc_no: formVergiTcNo.trim() || null,
            telefon: formTelefon.trim() || null,
            email: formEmail.trim() || null,
            tur: formTur,
            bakiye: 0,
          });

        if (insertErr) throw insertErr;
      }

      setIsModalOpen(false);
      await fetchCariler();
    } catch (err: unknown) {
      setError(handleSupabaseError(err, 'Cari kaydedilirken hata oluştu.'));
    } finally {
      setFormLoading(false);
    }
  };

  const handleDeleteCari = async () => {
    if (!cariToDelete || !firma?.id) return;
    try {
      setError(null);
      const { error: delErr } = await supabase
        .from('cariler')
        .delete()
        .eq('id', cariToDelete.id)
        .eq('firma_id', firma.id);

      if (delErr) throw delErr;

      setCariToDelete(null);
      await fetchCariler();
    } catch (err: unknown) {
      setError(handleSupabaseError(err, 'Cari silinemedi. Bu cariye bağlı işlemler veya faturalar olabilir.'));
    }
  };

  // Cari Detay ve Hareketleri Yükle
  const openDetail = async (cari: Cari) => {
    setSelectedCariForDetail(cari);
    setLoadingDetail(true);

    try {
      const { data: freshCari } = await supabase
        .from('cariler')
        .select('*')
        .eq('id', cari.id)
        .maybeSingle();
      if (freshCari) {
        setSelectedCariForDetail(freshCari as Cari);
      }

      // 1. İşlemleri getir (yapan kullanıcı profili ile)
      const { data: islemlerData } = await supabase
        .from('islemler')
        .select('*, profiles:yapan_user_id(ad_soyad)')
        .eq('cari_id', cari.id)
        .order('tarih', { ascending: false });

      // 2. Faturaları getir
      const { data: faturalarData } = await supabase
        .from('faturalar')
        .select('*')
        .eq('cari_id', cari.id)
        .order('tarih', { ascending: false });

      // Birleştir ve tarihe göre sırala
      const combined: Array<Islem | (Fatura & { tip: string })> = [
        ...((islemlerData as Islem[]) || []),
        ...(((faturalarData as Fatura[]) || []).map((f) => ({
          ...f,
          tip: f.yon === 'satis' ? 'satış faturası' : 'alış faturası',
        }))),
      ];

      combined.sort((a, b) => new Date(b.tarih).getTime() - new Date(a.tarih).getTime());
      setDetailMovements(combined);
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingDetail(false);
    }
  };

  const handleExportCariEkstresiExcel = () => {
    if (!selectedCariForDetail) return;
    const headers = ['Tarih', 'Belge No / Makbuz', 'İşlem Tipi', 'Açıklama', 'İşlemi Yapan', 'Durum', 'Tutar (TL)'];
    const rows = detailMovements.map((m: any) => [
      formatDate(m.tarih),
      m.makbuz_no || m.fatura_no || m.belge_no || '-',
      (m.tip || '').toUpperCase(),
      m.aciklama || '-',
      m.profiles?.ad_soyad || 'Yönetici',
      m.iptal ? 'İPTAL' : 'AKTİF',
      Number(m.tutar) || 0,
    ]);
    const cleanName = selectedCariForDetail.unvan.toLowerCase().replace(/[^a-z0-9]/g, '_');
    exportToExcel(`cari_ekstre_${cleanName}`, headers, rows);
  };

  const handleExportCariEkstresiPdf = () => {
    if (!selectedCariForDetail) return;
    const headers = ['Tarih', 'Belge No / Makbuz', 'İşlem Tipi', 'Açıklama', 'İşlemi Yapan', 'Tutar'];
    let totalTahsilat = 0;
    let totalTediye = 0;
    const rows = detailMovements.map((m: any) => {
      const tutar = Number(m.tutar) || 0;
      if (!m.iptal) {
        if (m.tip === 'tahsilat') totalTahsilat += tutar;
        else if (m.tip === 'tediye') totalTediye += tutar;
      }
      return [
        formatDate(m.tarih),
        m.makbuz_no || m.fatura_no || m.belge_no || '-',
        m.iptal ? `${(m.tip || '').toUpperCase()} (İPTAL)` : (m.tip || '').toUpperCase(),
        m.aciklama || '-',
        m.profiles?.ad_soyad || 'Yönetici',
        formatCurrency(tutar),
      ];
    });

    const summary = [
      { label: 'Cari Türü', value: selectedCariForDetail.tur === 'alici' ? 'Alıcı (Müşteri)' : 'Tedarikçi' },
      { label: 'Toplam Tahsilat', value: formatCurrency(totalTahsilat) },
      { label: 'Toplam Tediye', value: formatCurrency(totalTediye) },
      { label: 'Net Bakiye', value: formatCurrency(Number(selectedCariForDetail.bakiye) || 0) },
    ];

    printPdfReport(
      `CARİ HESAP EKSTRESİ: ${selectedCariForDetail.unvan}`,
      `VKN/TCKN: ${selectedCariForDetail.vergi_tc_no || '-'} | Tel: ${selectedCariForDetail.telefon || '-'}`,
      headers,
      rows,
      summary
    );
  };

  // Filtreleme
  const filteredCariler = cariler.filter((c) => {
    const matchesTur = turFilter === 'all' || c.tur === turFilter;
    const q = searchQuery.toLowerCase().trim();
    const matchesSearch =
      !q ||
      c.unvan.toLowerCase().includes(q) ||
      (c.vergi_tc_no && c.vergi_tc_no.toLowerCase().includes(q)) ||
      (c.telefon && c.telefon.includes(q));
    return matchesTur && matchesSearch;
  });

  return (
    <div className="space-y-6">
      {/* BAŞLIK & EYEBROW */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-teal-500/10 border border-teal-500/20 text-teal-400 text-[11px] font-semibold uppercase tracking-wider mb-2">
            <Users className="w-3 h-3" />
            <span>Müşteri ve Tedarikçiler</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">Cari Hesaplar</h1>
          <p className="text-xs text-gray-400 mt-1">
            Alıcı ve tedarikçi firmalarınızın bakiye durumları ve işlem hareketleri
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
          <button
            type="button"
            onClick={() => setIsUblModalOpen(true)}
            data-testid="open_ubl_import_button"
            className="bg-amber-400/15 hover:bg-amber-400/25 border border-amber-400/35 text-amber-300 font-bold text-xs px-4 py-2.5 rounded-xl transition flex items-center gap-2"
          >
            <Upload className="w-4 h-4" />
            <span>UBL / XML Fatura Yükle</span>
          </button>

          <button
            onClick={openAddModal}
            className="bg-teal-400 hover:bg-teal-300 text-[#0a0e13] font-bold text-xs px-4 py-2.5 rounded-xl transition shadow-[0_0_20px_rgba(45,212,191,0.25)] flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            <span>Yeni Cari Ekle</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
          <button onClick={() => setError(null)} className="text-gray-400 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* FİLTRE & ARAMA ÇUBUĞU */}
      <div className="bg-[#111820] border border-white/[0.07] rounded-2xl p-4 flex flex-col sm:flex-row items-center justify-between gap-4">
        {/* Arama Inputu */}
        <div className="relative w-full sm:w-80">
          <Search className="w-4 h-4 absolute left-3.5 top-3 text-gray-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Unvan, VKN veya telefon ile ara..."
            className="w-full bg-[#0a0e13] border border-white/10 rounded-xl pl-10 pr-4 py-2 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-teal-400 focus:ring-1 focus:ring-teal-400 transition"
          />
        </div>

        {/* Tümü / Alıcı / Tedarikçi Sekmeleri */}
        <div className="flex items-center rounded-xl bg-black/40 p-1 border border-white/[0.05] w-full sm:w-auto">
          <button
            onClick={() => setTurFilter('all')}
            className={`flex-1 sm:flex-none px-4 py-1.5 text-xs font-semibold rounded-lg transition ${
              turFilter === 'all'
                ? 'bg-teal-400 text-[#0a0e13] shadow'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            Tümü ({cariler.length})
          </button>
          <button
            onClick={() => setTurFilter('alici')}
            className={`flex-1 sm:flex-none px-4 py-1.5 text-xs font-semibold rounded-lg transition ${
              turFilter === 'alici'
                ? 'bg-teal-400 text-[#0a0e13] shadow'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            Alıcılar
          </button>
          <button
            onClick={() => setTurFilter('tedarikci')}
            className={`flex-1 sm:flex-none px-4 py-1.5 text-xs font-semibold rounded-lg transition ${
              turFilter === 'tedarikci'
                ? 'bg-teal-400 text-[#0a0e13] shadow'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            Tedarikçiler
          </button>
        </div>
      </div>

      {/* CARİ LİSTESİ TABLOSU / MOBİL KARTLAR */}
      <div className="bg-[#111820] border border-white/[0.07] rounded-2xl overflow-hidden shadow-xl">
        {loading ? (
          <div className="p-12 text-center text-xs text-gray-400">Cariler yükleniyor...</div>
        ) : filteredCariler.length === 0 ? (
          <div className="p-12 text-center">
            <Users className="w-10 h-10 text-gray-600 mx-auto mb-2" />
            <p className="text-xs text-gray-400">Kriterlere uygun cari bulunamadı.</p>
          </div>
        ) : (
          <div>
            {/* MASAÜSTÜ TABLO */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-white/[0.06] bg-black/20 text-gray-400 text-[11px] uppercase tracking-wider font-semibold">
                    <th className="py-3 px-5">Cari Unvanı</th>
                    <th className="py-3 px-4">Tür</th>
                    <th className="py-3 px-4">Vergi / TCKN</th>
                    <th className="py-3 px-4">İletişim</th>
                    <th className="py-3 px-4 text-right">Güncel Bakiye (₺)</th>
                    <th className="py-3 px-5 text-right">İşlemler</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.04]">
                  {filteredCariler.map((c) => {
                    const bakiye = Number(c.bakiye) || 0;
                    return (
                      <tr
                        key={c.id}
                        className="hover:bg-white/[0.03] transition group cursor-pointer"
                        onClick={() => openDetail(c)}
                      >
                        <td className="py-3.5 px-5">
                          <div className="font-bold text-white group-hover:text-teal-300 transition">{c.unvan}</div>
                          {c.email && <div className="text-[11px] text-gray-500 mt-0.5">{c.email}</div>}
                        </td>
                        <td className="py-3.5 px-4">
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                              c.tur === 'alici'
                                ? 'bg-teal-500/10 text-teal-400 border border-teal-500/20'
                                : 'bg-orange-500/10 text-orange-400 border border-orange-500/20'
                            }`}
                          >
                            {c.tur === 'alici' ? 'Alıcı' : 'Tedarikçi'}
                          </span>
                        </td>
                        <td className="py-3.5 px-4 font-mono text-gray-300">{c.vergi_tc_no || '-'}</td>
                        <td className="py-3.5 px-4 text-gray-400">{c.telefon || '-'}</td>
                        <td className="py-3.5 px-4 text-right whitespace-nowrap">
                          <span
                            className={`font-bold text-sm ${
                              bakiye > 0
                                ? 'text-teal-400'
                                : bakiye < 0
                                ? 'text-red-400'
                                : 'text-gray-400'
                            }`}
                          >
                            {formatCurrency(bakiye)}
                          </span>
                          <div className="text-[10px] text-gray-500">
                            {bakiye > 0 ? '(Bize Borçlu)' : bakiye < 0 ? '(Biz Borçluyuz)' : '(Bakiye Sıfır)'}
                          </div>
                        </td>
                        <td
                          className="py-3.5 px-5 text-right whitespace-nowrap"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              onClick={() => openEditModal(c)}
                              title="Düzenle"
                              className="p-1.5 text-gray-400 hover:text-white hover:bg-white/5 rounded-lg transition"
                            >
                              <Edit2 className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => setCariToDelete(c)}
                              title="Sil"
                              className="p-1.5 text-gray-400 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* MOBİL KART GÖRÜNÜMÜ */}
            <div className="md:hidden divide-y divide-white/[0.04]">
              {filteredCariler.map((c) => {
                const bakiye = Number(c.bakiye) || 0;
                return (
                  <div
                    key={c.id}
                    onClick={() => openDetail(c)}
                    className="p-4 hover:bg-white/[0.03] transition cursor-pointer"
                  >
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div>
                        <div className="font-bold text-white text-sm">{c.unvan}</div>
                        <div className="flex items-center gap-2 mt-1">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                              c.tur === 'alici'
                                ? 'bg-teal-500/10 text-teal-400'
                                : 'bg-orange-500/10 text-orange-400'
                            }`}
                          >
                            {c.tur === 'alici' ? 'Alıcı' : 'Tedarikçi'}
                          </span>
                          {c.vergi_tc_no && (
                            <span className="font-mono text-[11px] text-gray-400">{c.vergi_tc_no}</span>
                          )}
                        </div>
                      </div>

                      <div className="text-right">
                        <div
                          className={`font-bold text-sm ${
                            bakiye > 0
                              ? 'text-teal-400'
                              : bakiye < 0
                              ? 'text-red-400'
                              : 'text-gray-400'
                          }`}
                        >
                          {formatCurrency(bakiye)}
                        </div>
                        <div className="text-[10px] text-gray-500">
                          {bakiye > 0 ? 'Borçlu' : bakiye < 0 ? 'Alacaklı' : '0 ₺'}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center justify-between text-xs text-gray-400 pt-2 border-t border-white/[0.04]">
                      <div className="flex items-center gap-3">
                        {c.telefon && (
                          <span className="flex items-center gap-1">
                            <Phone className="w-3 h-3" />
                            {c.telefon}
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                        <button
                          onClick={() => openEditModal(c)}
                          className="p-1 text-gray-400 hover:text-white"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => setCariToDelete(c)}
                          className="p-1 text-gray-400 hover:text-red-400"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* CARİ DETAY VE HAREKETLER MODALI */}
      {selectedCariForDetail && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#111820] border border-white/10 rounded-2xl w-full max-w-3xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
            {/* Başlık */}
            <div className="p-5 border-b border-white/[0.07] flex items-center justify-between">
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-teal-400">
                  Cari Detayı & Hareketleri
                </span>
                <h3 className="text-lg font-bold text-white">{selectedCariForDetail.unvan}</h3>
              </div>
              <button
                onClick={() => setSelectedCariForDetail(null)}
                className="p-1.5 text-gray-400 hover:text-white rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Özet ve Bakiye Kartı */}
            <div className="p-5 bg-black/20 border-b border-white/[0.06] grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <div className="text-[10px] text-gray-400 uppercase font-semibold">Cari Türü & VKN</div>
                <div className="text-xs font-semibold text-white mt-1 capitalize">
                  {selectedCariForDetail.tur === 'alici' ? 'Alıcı (Müşteri)' : 'Tedarikçi'}
                </div>
                <div className="text-xs text-gray-400 font-mono mt-0.5">
                  {selectedCariForDetail.vergi_tc_no || 'VKN Belirtilmemiş'}
                </div>
              </div>

              <div>
                <div className="text-[10px] text-gray-400 uppercase font-semibold">İletişim Bilgileri</div>
                <div className="text-xs text-white mt-1">{selectedCariForDetail.telefon || '-'}</div>
                <div className="text-xs text-gray-400 mt-0.5">{selectedCariForDetail.email || '-'}</div>
              </div>

              <div className="sm:text-right">
                <div className="text-[10px] text-gray-400 uppercase font-semibold">Güncel Bakiye</div>
                <div
                  className={`text-xl font-black mt-1 ${
                    Number(selectedCariForDetail.bakiye) > 0
                      ? 'text-teal-400'
                      : Number(selectedCariForDetail.bakiye) < 0
                      ? 'text-red-400'
                      : 'text-gray-400'
                  }`}
                >
                  {formatCurrency(selectedCariForDetail.bakiye)}
                </div>
                <div className="text-[10px] text-gray-500">
                  {Number(selectedCariForDetail.bakiye) > 0
                    ? '+ Cari Bize Borçlu'
                    : Number(selectedCariForDetail.bakiye) < 0
                    ? '- Biz Borçluyuz'
                    : 'Bakiye Sıfır'}
                </div>
              </div>
            </div>

            {/* Hızlı Aksiyon Butonları */}
            <div className="px-5 py-3 border-b border-white/[0.06] flex items-center justify-between bg-black/10">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    const cid = selectedCariForDetail.id;
                    setSelectedCariForDetail(null);
                    onNavigate('tahsilat', { cariId: cid });
                  }}
                  className="px-3 py-1.5 rounded-lg bg-teal-400 text-[#0a0e13] font-bold text-xs flex items-center gap-1.5 hover:bg-teal-300 transition"
                >
                  <ArrowDownLeft className="w-3.5 h-3.5" />
                  <span>Tahsilat Gir</span>
                </button>
                <button
                  onClick={() => {
                    const cid = selectedCariForDetail.id;
                    setSelectedCariForDetail(null);
                    onNavigate('tediye', { cariId: cid });
                  }}
                  className="px-3 py-1.5 rounded-lg bg-orange-500/20 text-orange-400 border border-orange-500/30 font-bold text-xs flex items-center gap-1.5 hover:bg-orange-500/30 transition"
                >
                  <ArrowUpRight className="w-3.5 h-3.5" />
                  <span>Tediye Gir</span>
                </button>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={handleExportCariEkstresiExcel}
                  className="px-3 py-1.5 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 text-xs font-semibold flex items-center gap-1.5 border border-emerald-500/30 transition"
                  title="Excel (CSV) Olarak İndir"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Excel'e Aktar</span>
                </button>
                <button
                  onClick={handleExportCariEkstresiPdf}
                  className="px-3 py-1.5 rounded-lg bg-teal-500/15 hover:bg-teal-500/25 text-teal-300 text-xs font-semibold flex items-center gap-1.5 border border-teal-500/30 transition"
                  title="A4 PDF Raporu Yazdır"
                >
                  <Printer className="w-3.5 h-3.5 text-teal-400" />
                  <span>PDF Yazdır</span>
                </button>
              </div>
            </div>

            {/* Hareketler Listesi */}
            <div className="flex-1 overflow-y-auto p-5">
              <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">
                Hesap Hareketleri (İşlemler ve Faturalar)
              </h4>

              {loadingDetail ? (
                <div className="py-8 text-center text-xs text-gray-400">Hareketler yükleniyor...</div>
              ) : detailMovements.length === 0 ? (
                <div className="py-8 text-center text-xs text-gray-500">
                  Bu cariye ait henüz işlem veya fatura hareketi bulunmuyor.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-white/[0.06] text-gray-400 text-[10px] uppercase font-semibold">
                        <th className="py-2">Tarih</th>
                        <th className="py-2">Belge No / Makbuz</th>
                        <th className="py-2">İşlem Türü</th>
                        <th className="py-2">İşlemi Yapan</th>
                        <th className="py-2 text-right">Tutar</th>
                        <th className="py-2 text-right">İşlem</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/[0.04]">
                      {detailMovements.map((m: any, idx) => {
                        const isIslem = 'tip' in m && (m.tip === 'tahsilat' || m.tip === 'tediye');
                        const isIptal = m.iptal;
                        return (
                          <tr key={idx} className="hover:bg-white/[0.02]">
                            <td className="py-2.5 text-gray-300">{formatDate(m.tarih)}</td>
                            <td className="py-2.5 font-mono text-teal-400">
                              {m.makbuz_no || m.fatura_no || m.belge_no || '-'}
                            </td>
                            <td className="py-2.5">
                              <span
                                className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                                  m.tip === 'tahsilat'
                                    ? 'bg-teal-500/10 text-teal-400'
                                    : m.tip === 'tediye'
                                    ? 'bg-orange-500/10 text-orange-400'
                                    : 'bg-blue-500/10 text-blue-400'
                                }`}
                              >
                                {m.tip}
                              </span>
                              {isIptal && (
                                <span className="ml-1.5 text-[10px] text-red-400 font-bold">(İPTAL)</span>
                              )}
                            </td>
                            <td className="py-2.5 text-gray-400">
                              {m.profiles?.ad_soyad || (isIslem ? 'Yönetici' : '-')}
                            </td>
                            <td
                              className={`py-2.5 text-right font-bold ${
                                isIptal
                                  ? 'line-through text-gray-500'
                                  : m.tip === 'tahsilat'
                                  ? 'text-teal-400'
                                  : 'text-orange-400'
                              }`}
                            >
                              {formatCurrency(m.tutar)}
                            </td>
                            <td className="py-2.5 text-right">
                              {isIslem && onOpenMakbuz ? (
                                <button
                                  type="button"
                                  onClick={() => {
                                    onOpenMakbuz({
                                      ...m,
                                      cariler: selectedCariForDetail,
                                    });
                                  }}
                                  className="px-2.5 py-1 rounded-lg bg-teal-500/15 hover:bg-teal-500/30 text-teal-300 border border-teal-500/30 text-[11px] font-bold inline-flex items-center gap-1 transition"
                                  title="Makbuzu Görüntüle ve Yazdır / Paylaş"
                                >
                                  <ExternalLink className="w-3 h-3 text-teal-400" />
                                  <span>Makbuz</span>
                                </button>
                              ) : (
                                <span className="text-gray-500 text-[10px]">-</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* EKLE / DÜZENLE MODALI */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#111820] border border-white/10 rounded-2xl w-full max-w-md p-6 shadow-2xl">
            <div className="flex items-center justify-between pb-4 border-b border-white/[0.07] mb-4">
              <h3 className="font-bold text-white text-base">
                {editingCari ? 'Cari Kartını Düzenle' : 'Yeni Cari Kartı Oluştur'}
              </h3>
              <button
                onClick={() => setIsModalOpen(false)}
                className="text-gray-400 hover:text-white p-1"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveCari} className="space-y-4 text-xs">
              <div>
                <label className="block text-gray-300 font-semibold mb-1">Cari Türü *</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setFormTur('alici')}
                    className={`py-2 rounded-xl border text-center font-bold transition ${
                      formTur === 'alici'
                        ? 'bg-teal-400 text-[#0a0e13] border-teal-400 shadow-sm'
                        : 'bg-black/30 border-white/10 text-gray-400 hover:text-white'
                    }`}
                  >
                    Alıcı (Müşteri)
                  </button>
                  <button
                    type="button"
                    onClick={() => setFormTur('tedarikci')}
                    className={`py-2 rounded-xl border text-center font-bold transition ${
                      formTur === 'tedarikci'
                        ? 'bg-orange-500 text-[#0a0e13] border-orange-500 shadow-sm'
                        : 'bg-black/30 border-white/10 text-gray-400 hover:text-white'
                    }`}
                  >
                    Tedarikçi (Satıcı)
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-gray-300 font-semibold mb-1">Cari Unvanı *</label>
                <input
                  type="text"
                  required
                  value={formUnvan}
                  onChange={(e) => setFormUnvan(e.target.value)}
                  placeholder="Örn: Atlas Dağıtım Pazarlama A.Ş."
                  className="w-full bg-[#0a0e13] border border-white/10 rounded-xl px-3 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:border-teal-400"
                />
              </div>

              <div>
                <label className="block text-gray-300 font-semibold mb-1">Vergi No / TCKN</label>
                <input
                  type="text"
                  value={formVergiTcNo}
                  onChange={(e) => setFormVergiTcNo(e.target.value)}
                  placeholder="10 haneli VKN veya 11 haneli TCKN"
                  className="w-full bg-[#0a0e13] border border-white/10 rounded-xl px-3 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:border-teal-400 font-mono"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-gray-300 font-semibold mb-1">Telefon</label>
                  <input
                    type="tel"
                    value={formTelefon}
                    onChange={(e) => setFormTelefon(e.target.value)}
                    placeholder="05XX XXX XX XX"
                    className="w-full bg-[#0a0e13] border border-white/10 rounded-xl px-3 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:border-teal-400"
                  />
                </div>
                <div>
                  <label className="block text-gray-300 font-semibold mb-1">E-posta</label>
                  <input
                    type="email"
                    value={formEmail}
                    onChange={(e) => setFormEmail(e.target.value)}
                    placeholder="muhasebe@cari.com"
                    className="w-full bg-[#0a0e13] border border-white/10 rounded-xl px-3 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:border-teal-400"
                  />
                </div>
              </div>

              <div className="pt-2 flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2.5 rounded-xl border border-white/10 text-gray-300 hover:bg-white/5 font-semibold transition"
                >
                  İptal
                </button>
                <button
                  type="submit"
                  disabled={formLoading}
                  className="px-5 py-2.5 rounded-xl bg-teal-400 hover:bg-teal-300 text-[#0a0e13] font-bold shadow-[0_0_15px_rgba(45,212,191,0.25)] transition disabled:opacity-50"
                >
                  {formLoading ? 'Kaydediliyor...' : editingCari ? 'Güncelle' : 'Cariyi Kaydet'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* SİLME ONAY MODALI */}
      {cariToDelete && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#111820] border border-white/10 rounded-2xl w-full max-w-sm p-6 shadow-2xl text-center">
            <div className="w-12 h-12 rounded-2xl bg-red-500/20 text-red-400 flex items-center justify-center mx-auto mb-3">
              <Trash2 className="w-6 h-6" />
            </div>
            <h3 className="font-bold text-white text-base">Cariyi Silmek İstiyor musunuz?</h3>
            <p className="text-xs text-gray-400 mt-2 leading-relaxed">
              <strong className="text-white">{cariToDelete.unvan}</strong> cari kartı silinecektir. Bu işlem geri alınamaz.
            </p>
            <div className="mt-5 flex items-center justify-center gap-3">
              <button
                onClick={() => setCariToDelete(null)}
                className="px-4 py-2 rounded-xl border border-white/10 text-gray-300 text-xs font-semibold hover:bg-white/5 transition"
              >
                Vazgeç
              </button>
              <button
                onClick={handleDeleteCari}
                className="px-4 py-2 rounded-xl bg-red-500 hover:bg-red-600 text-white text-xs font-bold transition shadow-md"
              >
                Evet, Sil
              </button>
            </div>
          </div>
        </div>
      )}
      {/* UBL / XML FATURA YÜKLEME MODALI */}
      <UblImportModal
        isOpen={isUblModalOpen}
        onClose={() => setIsUblModalOpen(false)}
        cariler={cariler}
        onImported={fetchCariler}
      />
    </div>
  );
};
