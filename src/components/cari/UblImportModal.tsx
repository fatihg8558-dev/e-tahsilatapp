import React, { useState, useEffect, useRef } from 'react';
import {
  X,
  Upload,
  FileCode2,
  CheckCircle2,
  AlertCircle,
  UserPlus,
  Building2,
  Trash2,
  Code2,
  Copy,
  Check,
  ArrowUpRight,
  ArrowDownLeft,
  Info,
  Eye,
  Receipt,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { supabase, handleSupabaseError } from '../../lib/supabase';
import { Cari, CariTur, FaturaYon, Kasa } from '../../types/database';
import { formatCurrency, formatDate } from '../../lib/formatters';
import {
  parseUblInvoiceXml,
  ParsedUblInvoice,
  normalizeTaxId,
  UblPartyInfo,
} from '../../lib/ublParser';
import { isWebPlatform } from '../../lib/platform';
import {
  saveUblInvoiceSnapshotsAsync,
  syncUblDetayToSupabase,
} from '../../lib/ublInvoiceStore';
import { UblInvoicePreviewModal } from './UblInvoicePreviewModal';
import {
  evaluateCariRiskStatus,
  getEffectiveCariRiskLimit,
} from '../../lib/cariRiskAndMutabakat';
import { extractXmlFilesFromZip } from '../../lib/zipExtractor';
import {
  FATURA_GIDER_KATEGORILERI,
  fetchExpenseSyncedFaturaNos,
  normalizeFaturaNoKey,
  postFaturaAsKasaGider,
} from '../../lib/faturaExpenseService';

interface UblImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  cariler: Cari[];
  onImported: () => Promise<void> | void;
}

interface ExistingFaturaKey {
  fatura_no: string;
  yon: FaturaYon;
  cari_id: string;
}

interface MissingCariDraft {
  key: string;
  unvan: string;
  vergiTcNo: string;
  tur: CariTur;
  telefon: string;
  email: string;
  approved: boolean;
  creating?: boolean;
  createdCariId?: string;
}

interface ImportRow {
  id: string;
  fileName: string;
  source: 'xml' | 'zip';
  parsed?: ParsedUblInvoice;
  error?: string;
  yon: FaturaYon;
  selectedCariId: string; // existing cari id OR AUTO_CREATE_VALUE OR ''
  missingCariKey?: string;
  exchangeRate: number;
  tutarTL: number;
  include: boolean;
  isDuplicate: boolean;
  giderlestir: boolean;
  kasaId: string;
  giderKategori: string;
  alreadyExpenseSynced: boolean;
}

const AUTO_CREATE_VALUE = '__auto_create__';

function buildPartyDedupKey(party: UblPartyInfo): string {
  const normVkn = normalizeTaxId(party.vkn);
  if (normVkn) return normVkn;
  return (party.unvan || '').trim().toLocaleLowerCase('tr-TR').replace(/\s+/g, ' ');
}

export const UblImportModal: React.FC<UblImportModalProps> = ({
  isOpen,
  onClose,
  cariler,
  onImported,
}) => {
  const { firma, profile, isPeriodExpired } = useAuth();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const missingPanelRef = useRef<HTMLDivElement | null>(null);

  const [rows, setRows] = useState<ImportRow[]>([]);
  const [missingCariDrafts, setMissingCariDrafts] = useState<Record<string, MissingCariDraft>>({});
  const [sessionCreatedCaris, setSessionCreatedCaris] = useState<Cari[]>([]);
  const [existingInvoices, setExistingInvoices] = useState<ExistingFaturaKey[]>([]);
  const [expenseSyncedNos, setExpenseSyncedNos] = useState<Set<string>>(new Set());
  const [kasalar, setKasalar] = useState<Kasa[]>([]);

  // Toplu giderleştirme varsayılanları
  const [bulkGiderKasaId, setBulkGiderKasaId] = useState('');
  const [bulkGiderKategori, setBulkGiderKategori] = useState('Mal / Hizmet Alımı');

  const [isDragging, setIsDragging] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [feedback, setFeedback] = useState<{
    type: 'success' | 'error';
    text: string;
    showSqlHint?: boolean;
  } | null>(null);
  const [showSqlHelp, setShowSqlHelp] = useState(false);
  const [copiedSql, setCopiedSql] = useState(false);
  const [previewRow, setPreviewRow] = useState<{
    parsed: ParsedUblInvoice;
    yon: FaturaYon;
  } | null>(null);

  const showInvoicePreview = isWebPlatform();

  const allCariler = React.useMemo(() => {
    const merged = [...cariler];
    for (const sc of sessionCreatedCaris) {
      if (!merged.some((c) => c.id === sc.id)) {
        merged.push(sc);
      }
    }
    return merged;
  }, [cariler, sessionCreatedCaris]);

  const loadExistingInvoices = async (): Promise<ExistingFaturaKey[]> => {
    if (!firma?.id) return [];
    const { data, error } = await supabase
      .from('faturalar')
      .select('fatura_no, yon, cari_id')
      .eq('firma_id', firma.id);

    if (error || !data) return existingInvoices;
    const list = data as ExistingFaturaKey[];
    setExistingInvoices(list);
    return list;
  };

  const loadModalDependencies = async () => {
    if (!firma?.id) return;
    const [, syncedSet, kasaRes] = await Promise.all([
      loadExistingInvoices(),
      fetchExpenseSyncedFaturaNos(firma.id),
      supabase
        .from('kasalar')
        .select('*')
        .eq('firma_id', firma.id)
        .eq('aktif', true)
        .order('created_at', { ascending: true }),
    ]);

    setExpenseSyncedNos(syncedSet);
    const activeKasalar = (!kasaRes.error && Array.isArray(kasaRes.data) ? (kasaRes.data as Kasa[]) : []);
    setKasalar(activeKasalar);

    const preferredKasa =
      activeKasalar.find((k) => k.tur === 'nakit')?.id ||
      activeKasalar[0]?.id ||
      '';
    setBulkGiderKasaId(preferredKasa);
    setBulkGiderKategori(FATURA_GIDER_KATEGORILERI[0]);
  };

  useEffect(() => {
    if (isOpen && firma?.id) {
      setFeedback(null);
      loadModalDependencies();
    }
    if (!isOpen) {
      setRows([]);
      setMissingCariDrafts({});
      setSessionCreatedCaris([]);
      setFeedback(null);
      setIsDragging(false);
      setShowSqlHelp(false);
      setPreviewRow(null);
    }
  }, [isOpen, firma?.id]);

  const findMatchingCariId = (party: UblPartyInfo): string => {
    const normVkn = normalizeTaxId(party.vkn);
    if (normVkn) {
      const match = allCariler.find((c) => normalizeTaxId(c.vergi_tc_no) === normVkn);
      if (match) return match.id;
    } else if (party.unvan && party.unvan !== 'Bilinmeyen Cari') {
      const normName = party.unvan.trim().toLocaleLowerCase('tr-TR').replace(/\s+/g, ' ');
      const nameMatch = allCariler.find(
        (c) => c.unvan.trim().toLocaleLowerCase('tr-TR').replace(/\s+/g, ' ') === normName
      );
      if (nameMatch) return nameMatch.id;
    }
    if (party.vkn || (party.unvan && party.unvan !== 'Bilinmeyen Cari')) {
      return AUTO_CREATE_VALUE;
    }
    return '';
  };

  const ensureDraftForRow = (
    draftMap: Record<string, MissingCariDraft>,
    party: UblPartyInfo,
    yon: FaturaYon
  ): string | undefined => {
    const key = buildPartyDedupKey(party);
    if (!key) return undefined;
    if (!draftMap[key]) {
      draftMap[key] = {
        key,
        unvan: party.unvan?.trim() || 'Bilinmeyen Cari',
        vergiTcNo: normalizeTaxId(party.vkn),
        tur: yon === 'satis' ? 'alici' : 'tedarikci',
        telefon: party.telefon?.trim() || '',
        email: party.email?.trim() || '',
        approved: false,
      };
    }
    return key;
  };

  const isDuplicateFatura = (
    faturaNo: string,
    yon: FaturaYon,
    knownInvoices: ExistingFaturaKey[]
  ): boolean => {
    const cleanNo = normalizeFaturaNoKey(faturaNo);
    return knownInvoices.some(
      (f) => normalizeFaturaNoKey(f.fatura_no) === cleanNo && f.yon === yon
    );
  };

  const mergeRowsDeduplicated = (newRows: ImportRow[]) => {
    setRows((prev) => {
      const merged = [...prev];
      for (const nr of newRows) {
        const existsInBatch =
          nr.parsed &&
          merged.some(
            (m) =>
              m.parsed &&
              normalizeFaturaNoKey(m.parsed.faturaNo) === normalizeFaturaNoKey(nr.parsed!.faturaNo) &&
              m.yon === nr.yon
          );
        if (!existsInBatch) {
          merged.push(nr);
        }
      }
      return merged;
    });
  };

  const syncDuplicateSnapshotsIfNeeded = async (newRows: ImportRow[]) => {
    if (!firma?.id || !showInvoicePreview) return;
    const parsedSnapshots = newRows
      .filter((r): r is ImportRow & { parsed: ParsedUblInvoice } => Boolean(r.parsed))
      .map((r) => ({ yon: r.yon, parsed: r.parsed }));
    if (parsedSnapshots.length > 0) {
      await saveUblInvoiceSnapshotsAsync(firma.id, parsedSnapshots);
    }

    const duplicateSnapshots = newRows
      .filter((r): r is ImportRow & { parsed: ParsedUblInvoice } =>
        Boolean(r.isDuplicate && r.parsed)
      )
      .map((r) => ({ yon: r.yon, parsed: r.parsed }));
    if (duplicateSnapshots.length > 0) {
      await syncUblDetayToSupabase(firma.id, duplicateSnapshots);
    }
  };

  const processFiles = async (fileList: FileList | File[]) => {
    const files = Array.from(fileList);
    if (files.length === 0) return;

    setParsing(true);
    setFeedback(null);

    try {
      const [latestInvoices, latestSyncedNos] = await Promise.all([
        loadExistingInvoices(),
        firma?.id ? fetchExpenseSyncedFaturaNos(firma.id) : Promise.resolve(expenseSyncedNos),
      ]);
      setExpenseSyncedNos(latestSyncedNos);

      const xmlEntries: Array<{ fileName: string; text: string; source: 'xml' | 'zip' }> = [];
      const newRows: ImportRow[] = [];

      for (const file of files) {
        const lowerName = file.name.toLowerCase();
        const isZip =
          lowerName.endsWith('.zip') ||
          file.type === 'application/zip' ||
          file.type === 'application/x-zip-compressed';

        if (isZip) {
          try {
            const buffer = await file.arrayBuffer();
            const extracted = await extractXmlFilesFromZip(buffer);
            if (extracted.length === 0) {
              newRows.push({
                id: `zip-empty-${file.name}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                fileName: file.name,
                source: 'zip',
                error: `${file.name}: ZIP arşivi içinde .xml veya .ubl fatura dosyası bulunamadı.`,
                yon: 'alis',
                selectedCariId: '',
                exchangeRate: 1,
                tutarTL: 0,
                include: false,
                isDuplicate: false,
                giderlestir: false,
                kasaId: bulkGiderKasaId,
                giderKategori: bulkGiderKategori,
                alreadyExpenseSynced: false,
              });
            } else {
              for (const item of extracted) {
                xmlEntries.push({
                  fileName: `${file.name} › ${item.name}`,
                  text: item.text,
                  source: 'zip',
                });
              }
            }
          } catch (zipErr: unknown) {
            newRows.push({
              id: `zip-err-${file.name}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              fileName: file.name,
              source: 'zip',
              error: zipErr instanceof Error ? zipErr.message : `${file.name} ZIP arşivi açılamadı.`,
              yon: 'alis',
              selectedCariId: '',
              exchangeRate: 1,
              tutarTL: 0,
              include: false,
              isDuplicate: false,
              giderlestir: false,
              kasaId: bulkGiderKasaId,
              giderKategori: bulkGiderKategori,
              alreadyExpenseSynced: false,
            });
          }
        } else {
          const text = await file.text();
          xmlEntries.push({ fileName: file.name, text, source: 'xml' });
        }
      }

      const nextDrafts: Record<string, MissingCariDraft> = { ...missingCariDrafts };

      for (const entry of xmlEntries) {
        const rowId = `${entry.fileName}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        try {
          const parsed = parseUblInvoiceXml(entry.text, entry.fileName, firma?.vergi_no, allCariler);
          const yon = parsed.detectedYon;
          const counterparty = yon === 'satis' ? parsed.customer : parsed.supplier;
          const selectedCariId = findMatchingCariId(counterparty);
          const missingCariKey =
            selectedCariId === AUTO_CREATE_VALUE
              ? ensureDraftForRow(nextDrafts, counterparty, yon)
              : undefined;
          const duplicate = isDuplicateFatura(parsed.faturaNo, yon, latestInvoices);
          const alreadySynced = latestSyncedNos.has(normalizeFaturaNoKey(parsed.faturaNo));

          newRows.push({
            id: rowId,
            fileName: entry.fileName,
            source: entry.source,
            parsed,
            yon,
            selectedCariId,
            missingCariKey,
            exchangeRate: parsed.exchangeRate,
            tutarTL: parsed.tutarTL,
            isDuplicate: duplicate,
            include: !duplicate && parsed.tutarTL > 0 && Boolean(selectedCariId),
            giderlestir: false,
            kasaId: bulkGiderKasaId,
            giderKategori: bulkGiderKategori,
            alreadyExpenseSynced: alreadySynced,
          });
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : `${entry.fileName} okunamadı.`;
          newRows.push({
            id: rowId,
            fileName: entry.fileName,
            source: entry.source,
            error: msg,
            yon: 'alis',
            selectedCariId: '',
            exchangeRate: 1,
            tutarTL: 0,
            isDuplicate: false,
            include: false,
            giderlestir: false,
            kasaId: bulkGiderKasaId,
            giderKategori: bulkGiderKategori,
            alreadyExpenseSynced: false,
          });
        }
      }

      setMissingCariDrafts(nextDrafts);
      await syncDuplicateSnapshotsIfNeeded(newRows);
      mergeRowsDeduplicated(newRows);
    } catch (err: unknown) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Dosyalar işlenirken beklenmeyen bir hata oluştu.',
      });
    } finally {
      setParsing(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleYonChange = (rowId: string, newYon: FaturaYon) => {
    const nextDrafts: Record<string, MissingCariDraft> = { ...missingCariDrafts };
    setRows((prev) =>
      prev.map((row) => {
        if (row.id !== rowId || !row.parsed) return row;
        const counterparty = newYon === 'satis' ? row.parsed.customer : row.parsed.supplier;
        const matchedCariId = findMatchingCariId(counterparty);
        const missingCariKey =
          matchedCariId === AUTO_CREATE_VALUE
            ? ensureDraftForRow(nextDrafts, counterparty, newYon)
            : undefined;
        const dup = isDuplicateFatura(row.parsed.faturaNo, newYon, existingInvoices);
        return {
          ...row,
          yon: newYon,
          selectedCariId: matchedCariId,
          missingCariKey,
          isDuplicate: dup,
          include: !dup && row.tutarTL > 0 && Boolean(matchedCariId),
          giderlestir: newYon === 'alis' ? row.giderlestir : false,
        };
      })
    );
    setMissingCariDrafts(nextDrafts);
  };

  const handleCariChange = (rowId: string, cariId: string) => {
    const nextDrafts: Record<string, MissingCariDraft> = { ...missingCariDrafts };
    setRows((prev) =>
      prev.map((row) => {
        if (row.id !== rowId) return row;
        let nextKey = row.missingCariKey;
        if (cariId === AUTO_CREATE_VALUE && row.parsed) {
          const party = row.yon === 'satis' ? row.parsed.customer : row.parsed.supplier;
          nextKey = ensureDraftForRow(nextDrafts, party, row.yon);
        }
        return {
          ...row,
          selectedCariId: cariId,
          missingCariKey: cariId === AUTO_CREATE_VALUE ? nextKey : undefined,
          include: cariId ? (!row.isDuplicate ? true : false) : false,
        };
      })
    );
    setMissingCariDrafts(nextDrafts);
  };

  const handleExchangeRateChange = (rowId: string, rawRate: string) => {
    const rate = parseFloat(rawRate.replace(',', '.'));
    setRows((prev) =>
      prev.map((row) => {
        if (row.id !== rowId || !row.parsed) return row;
        const validRate = isNaN(rate) || rate < 0 ? 0 : rate;
        const nextTL = Math.round(row.parsed.originalAmount * validRate * 100) / 100;
        return {
          ...row,
          exchangeRate: validRate,
          tutarTL: nextTL,
        };
      })
    );
  };

  const handleTutarChange = (rowId: string, rawTutar: string) => {
    const val = parseFloat(rawTutar.replace(',', '.'));
    setRows((prev) =>
      prev.map((row) =>
        row.id === rowId ? { ...row, tutarTL: isNaN(val) || val < 0 ? 0 : val } : row
      )
    );
  };

  const handleToggleInclude = (rowId: string) => {
    setRows((prev) =>
      prev.map((row) => {
        if (row.id !== rowId) return row;
        if (row.isDuplicate) return { ...row, include: false };
        return { ...row, include: !row.include };
      })
    );
  };

  const handleToggleGiderlestir = (rowId: string) => {
    setRows((prev) =>
      prev.map((row) => {
        if (row.id !== rowId || row.yon !== 'alis' || row.alreadyExpenseSynced) return row;
        const nextGider = !row.giderlestir;
        return {
          ...row,
          giderlestir: nextGider,
          kasaId: row.kasaId || bulkGiderKasaId,
          giderKategori: row.giderKategori || bulkGiderKategori,
          // Yeni fatura giderleştiriliyorsa cari kaydını da otomatik açık tut
          include: !row.isDuplicate && nextGider && Boolean(row.selectedCariId) ? true : row.include,
        };
      })
    );
  };

  const handleRowGiderPatch = (
    rowId: string,
    patch: Partial<Pick<ImportRow, 'kasaId' | 'giderKategori'>>
  ) => {
    setRows((prev) => prev.map((row) => (row.id === rowId ? { ...row, ...patch } : row)));
  };

  const handleBulkToggleGiderlestir = (enable: boolean) => {
    setRows((prev) =>
      prev.map((row) => {
        if (row.error || !row.parsed || row.yon !== 'alis' || row.alreadyExpenseSynced) {
          return row;
        }
        return {
          ...row,
          giderlestir: enable,
          kasaId: bulkGiderKasaId || row.kasaId,
          giderKategori: bulkGiderKategori || row.giderKategori,
          include:
            !row.isDuplicate && enable && Boolean(row.selectedCariId) ? true : row.include,
        };
      })
    );
  };

  const handleApplyBulkKasaAndKategori = (nextKasaId: string, nextKategori: string) => {
    setBulkGiderKasaId(nextKasaId);
    setBulkGiderKategori(nextKategori);
    setRows((prev) =>
      prev.map((row) =>
        row.yon === 'alis' && !row.alreadyExpenseSynced
          ? { ...row, kasaId: nextKasaId, giderKategori: nextKategori }
          : row
      )
    );
  };

  const handleRemoveRow = (rowId: string) => {
    setRows((prev) => prev.filter((r) => r.id !== rowId));
  };

  const cariRowsToInsert = rows.filter(
    (r) => r.include && !r.isDuplicate && !r.error && r.parsed && r.selectedCariId
  );

  const giderRowsToPost = rows.filter(
    (r) =>
      !r.error &&
      r.parsed &&
      r.yon === 'alis' &&
      r.giderlestir &&
      !r.alreadyExpenseSynced &&
      r.tutarTL > 0 &&
      (r.include || r.isDuplicate)
  );

  const incomingEligibleRows = rows.filter(
    (r) => !r.error && r.parsed && r.yon === 'alis' && !r.alreadyExpenseSynced
  );
  const allIncomingGiderChecked =
    incomingEligibleRows.length > 0 && incomingEligibleRows.every((r) => r.giderlestir);

  const activeMissingCaris = React.useMemo(() => {
    const grouped = new Map<string, { draft: MissingCariDraft; invoiceNos: string[] }>();
    for (const row of rows) {
      if (row.error || !row.parsed || row.selectedCariId !== AUTO_CREATE_VALUE || row.isDuplicate) {
        continue;
      }
      const party = row.yon === 'satis' ? row.parsed.customer : row.parsed.supplier;
      const key = row.missingCariKey || buildPartyDedupKey(party);
      if (!key) continue;
      const draft = missingCariDrafts[key] || {
        key,
        unvan: party.unvan?.trim() || 'Bilinmeyen Cari',
        vergiTcNo: normalizeTaxId(party.vkn),
        tur: row.yon === 'satis' ? 'alici' : 'tedarikci',
        telefon: party.telefon?.trim() || '',
        email: party.email?.trim() || '',
        approved: false,
      };
      const entry = grouped.get(key);
      if (entry) {
        entry.invoiceNos.push(row.parsed.faturaNo);
      } else {
        grouped.set(key, { draft, invoiceNos: [row.parsed.faturaNo] });
      }
    }
    return Array.from(grouped.values());
  }, [rows, missingCariDrafts]);

  const unapprovedSelectedMissingKeys = React.useMemo(() => {
    const keys = new Set<string>();
    for (const row of cariRowsToInsert) {
      if (row.selectedCariId !== AUTO_CREATE_VALUE || !row.parsed) continue;
      const party = row.yon === 'satis' ? row.parsed.customer : row.parsed.supplier;
      const key = row.missingCariKey || buildPartyDedupKey(party);
      if (!key) continue;
      const draft = missingCariDrafts[key];
      if (!draft?.approved && !draft?.createdCariId) {
        keys.add(key);
      }
    }
    return Array.from(keys);
  }, [cariRowsToInsert, missingCariDrafts]);

  const approvedNewCariCount = React.useMemo(() => {
    const keys = new Set<string>();
    for (const row of cariRowsToInsert) {
      if (row.selectedCariId !== AUTO_CREATE_VALUE || !row.parsed) continue;
      const party = row.yon === 'satis' ? row.parsed.customer : row.parsed.supplier;
      const key = row.missingCariKey || buildPartyDedupKey(party);
      const draft = key ? missingCariDrafts[key] : undefined;
      if (key && draft?.approved && !draft.createdCariId) {
        keys.add(key);
      }
    }
    return keys.size;
  }, [cariRowsToInsert, missingCariDrafts]);

  const updateMissingDraft = (key: string, patch: Partial<MissingCariDraft>) => {
    setMissingCariDrafts((prev) => {
      const current = prev[key];
      if (!current) return prev;
      return {
        ...prev,
        [key]: { ...current, ...patch },
      };
    });
  };

  const handleCreateSingleMissingCariNow = async (key: string) => {
    if (!firma?.id) return;
    const draft = missingCariDrafts[key];
    if (!draft) return;
    if (!draft.unvan.trim()) {
      setFeedback({ type: 'error', text: 'Yeni cari oluşturmak için unvan alanı boş bırakılamaz.' });
      return;
    }

    updateMissingDraft(key, { creating: true });
    setFeedback(null);

    try {
      const { data: insertedCari, error: cariErr } = await supabase
        .from('cariler')
        .insert({
          firma_id: firma.id,
          unvan: draft.unvan.trim(),
          vergi_tc_no: normalizeTaxId(draft.vergiTcNo) || null,
          telefon: draft.telefon.trim() || null,
          email: draft.email.trim() || null,
          tur: draft.tur,
          bakiye: 0,
        })
        .select('*')
        .single();

      if (cariErr) throw cariErr;
      const created = insertedCari as Cari;
      setSessionCreatedCaris((prev) => [...prev, created]);
      updateMissingDraft(key, {
        creating: false,
        approved: true,
        createdCariId: created.id,
      });

      setRows((prev) =>
        prev.map((row) => {
          if (row.selectedCariId !== AUTO_CREATE_VALUE || !row.parsed) return row;
          const party = row.yon === 'satis' ? row.parsed.customer : row.parsed.supplier;
          const rowKey = row.missingCariKey || buildPartyDedupKey(party);
          if (rowKey !== key) return row;
          return {
            ...row,
            selectedCariId: created.id,
            missingCariKey: undefined,
          };
        })
      );

      await onImported();
      setFeedback({
        type: 'success',
        text: `"${created.unvan}" cari kartı oluşturuldu ve ilgili faturalara bağlandı.`,
      });
    } catch (err: unknown) {
      updateMissingDraft(key, { creating: false });
      setFeedback({
        type: 'error',
        text: handleSupabaseError(err, 'Yeni cari kartı oluşturulamadı.', {
          isFirmaUnlimited: Boolean(firma?.sinirsiz),
        }),
      });
    }
  };

  const handleApproveAllMissingCaris = () => {
    setMissingCariDrafts((prev) => {
      const next = { ...prev };
      for (const item of activeMissingCaris) {
        if (next[item.draft.key]) {
          next[item.draft.key] = { ...next[item.draft.key], approved: true };
        }
      }
      return next;
    });
  };

  const handleImportConfirm = async () => {
    if (!firma?.id) return;
    if (isPeriodExpired) {
      setFeedback({
        type: 'error',
        text: 'Firma abonelik / deneme süreniz dolmuş görünüyor. Lütfen paket yenileyiniz.',
      });
      return;
    }

    if (cariRowsToInsert.length === 0 && giderRowsToPost.length === 0) {
      setFeedback({
        type: 'error',
        text: 'İşlenecek geçerli bir fatura veya giderleştirme seçilmedi.',
      });
      return;
    }

    if (unapprovedSelectedMissingKeys.length > 0) {
      setFeedback({
        type: 'error',
        text: `Sistemde bulunmayan ${unapprovedSelectedMissingKeys.length} yeni cari için henüz onay vermediniz. Lütfen "Sistemde Kayıtlı Olmayan Cariler" bölümünden bilgileri kontrol edip onaylayın veya fatura satırından mevcut bir cari seçin.`,
      });
      missingPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }

    setImporting(true);
    setFeedback(null);

    try {
      const createdCariByKey = new Map<string, Cari>();
      let createdCount = 0;

      // 1. Onaylanan yeni carileri oluştur
      for (const row of cariRowsToInsert) {
        if (row.selectedCariId !== AUTO_CREATE_VALUE || !row.parsed) continue;
        const party = row.yon === 'satis' ? row.parsed.customer : row.parsed.supplier;
        const dedupKey = row.missingCariKey || buildPartyDedupKey(party);
        const draft = missingCariDrafts[dedupKey];

        if (draft?.createdCariId) {
          const existingCreated = allCariler.find((c) => c.id === draft.createdCariId);
          if (existingCreated) {
            createdCariByKey.set(dedupKey, existingCreated);
            continue;
          }
        }

        if (createdCariByKey.has(dedupKey)) continue;

        const targetUnvan = (draft?.unvan ?? party.unvan).trim() || 'Bilinmeyen Cari';
        const targetVkn = normalizeTaxId(draft?.vergiTcNo ?? party.vkn) || null;
        const targetTelefon = (draft?.telefon ?? party.telefon ?? '').trim() || null;
        const targetEmail = (draft?.email ?? party.email ?? '').trim() || null;
        const targetTur: CariTur = draft?.tur ?? (row.yon === 'satis' ? 'alici' : 'tedarikci');

        const { data: insertedCari, error: cariErr } = await supabase
          .from('cariler')
          .insert({
            firma_id: firma.id,
            unvan: targetUnvan,
            vergi_tc_no: targetVkn,
            telefon: targetTelefon,
            email: targetEmail,
            tur: targetTur,
            bakiye: 0,
          })
          .select('*')
          .single();

        if (cariErr) throw cariErr;
        if (insertedCari) {
          createdCariByKey.set(dedupKey, insertedCari as Cari);
          createdCount++;
        }
      }

      // 2. Cari fatura kayıtları
      const resolvedPayloads: Array<{
        firma_id: string;
        cari_id: string;
        fatura_no: string;
        tarih: string;
        tutar: number;
        yon: FaturaYon;
      }> = [];
      const expectedDeltaByCari = new Map<string, number>();

      for (const row of cariRowsToInsert) {
        if (!row.parsed) continue;
        let targetCariId = row.selectedCariId;

        if (targetCariId === AUTO_CREATE_VALUE) {
          const party = row.yon === 'satis' ? row.parsed.customer : row.parsed.supplier;
          const dedupKey = row.missingCariKey || buildPartyDedupKey(party);
          const newCari = createdCariByKey.get(dedupKey);
          if (!newCari) {
            throw new Error(`${party.unvan} için cari kartı oluşturulamadı.`);
          }
          targetCariId = newCari.id;
        }

        const tutar = Math.round((Number(row.tutarTL) || 0) * 100) / 100;
        resolvedPayloads.push({
          firma_id: firma.id,
          cari_id: targetCariId,
          fatura_no: row.parsed.faturaNo.trim(),
          tarih: row.parsed.tarih,
          tutar,
          yon: row.yon,
        });

        const signedDelta = row.yon === 'satis' ? tutar : -tutar;
        expectedDeltaByCari.set(
          targetCariId,
          (expectedDeltaByCari.get(targetCariId) || 0) + signedDelta
        );
      }

      if (resolvedPayloads.length > 0) {
        const affectedCariIds = Array.from(expectedDeltaByCari.keys());
        const beforeBalanceMap = new Map<string, number>();
        if (affectedCariIds.length > 0) {
          const { data: beforeCaris } = await supabase
            .from('cariler')
            .select('id, bakiye')
            .in('id', affectedCariIds);
          (beforeCaris || []).forEach((c: { id: string; bakiye: number }) => {
            beforeBalanceMap.set(c.id, Number(c.bakiye) || 0);
          });
        }

        const { error: faturaErr } = await supabase.from('faturalar').insert(resolvedPayloads);
        if (faturaErr) throw faturaErr;

        if (affectedCariIds.length > 0) {
          const { data: afterCaris } = await supabase
            .from('cariler')
            .select('id, bakiye')
            .in('id', affectedCariIds);

          for (const c of (afterCaris || []) as Array<{ id: string; bakiye: number }>) {
            const beforeVal = beforeBalanceMap.get(c.id) ?? 0;
            const afterVal = Number(c.bakiye) || 0;
            const expectedDelta = expectedDeltaByCari.get(c.id) || 0;

            if (Math.abs(afterVal - beforeVal) < 0.005 && Math.abs(expectedDelta) >= 0.005) {
              const nextBakiye = Math.round((beforeVal + expectedDelta) * 100) / 100;
              await supabase
                .from('cariler')
                .update({ bakiye: nextBakiye })
                .eq('id', c.id)
                .eq('firma_id', firma.id);
            }
          }
        }

        if (firma.id && showInvoicePreview) {
          const snapshots = cariRowsToInsert
            .filter((r): r is ImportRow & { parsed: ParsedUblInvoice } => Boolean(r.parsed))
            .map((r) => ({ yon: r.yon, parsed: r.parsed }));
          await saveUblInvoiceSnapshotsAsync(firma.id, snapshots);
          await syncUblDetayToSupabase(firma.id, snapshots);
        }
      }

      // 3. Seçilen gelen (alış) faturalarını Kasa & Gelir-Gider tarafına "Giderleştir"
      let postedGiderCount = 0;
      let skippedGiderDupCount = 0;
      const giderErrors: string[] = [];
      let missingKasaTable = false;

      for (const row of giderRowsToPost) {
        if (!row.parsed) continue;
        const matchedCari =
          allCariler.find((c) => c.id === row.selectedCariId) ||
          (row.selectedCariId === AUTO_CREATE_VALUE
            ? createdCariByKey.get(
                row.missingCariKey || buildPartyDedupKey(row.parsed.supplier)
              )
            : undefined);

        const cariUnvan = matchedCari?.unvan || row.parsed.supplier.unvan || 'Tedarikçi';
        const res = await postFaturaAsKasaGider({
          firmaId: firma.id,
          faturaNo: row.parsed.faturaNo,
          cariUnvan,
          tutar: row.tutarTL,
          tarih: row.parsed.tarih,
          kasaId: row.kasaId || bulkGiderKasaId || null,
          kategori: row.giderKategori || bulkGiderKategori,
          userId: profile?.id || null,
          knownKasalar: kasalar,
        });

        if (res.posted) {
          postedGiderCount++;
        } else if (res.skippedDuplicate) {
          skippedGiderDupCount++;
        } else if (res.reason === 'kasa_table_missing') {
          missingKasaTable = true;
        } else if (res.error) {
          giderErrors.push(`${row.parsed.faturaNo}: ${res.error}`);
        }
      }

      await onImported();

      const parts: string[] = [];
      if (resolvedPayloads.length > 0) {
        parts.push(
          `${resolvedPayloads.length} fatura cari hesaba işlendi${
            createdCount > 0 ? ` (${createdCount} yeni cari açıldı)` : ''
          }`
        );
      }
      if (postedGiderCount > 0) {
        parts.push(`${postedGiderCount} fatura seçilen kasaya gider olarak eklendi`);
      }
      if (skippedGiderDupCount > 0) {
        parts.push(`${skippedGiderDupCount} fatura daha önce giderleştirildiği için atlandı`);
      }

      if (missingKasaTable) {
        setFeedback({
          type: 'error',
          text: `${parts.join(' • ')}. Ancak Kasa / Gelir-Gider tabloları veritabanında henüz kurulmadığı için kasaya gider eklenemedi.`,
        });
      } else if (giderErrors.length > 0) {
        setFeedback({
          type: 'error',
          text: `${parts.join(' • ')}. Bazı gider kayıtlarında hata oluştu: ${giderErrors.join(' | ')}`,
        });
      } else {
        setFeedback({
          type: 'success',
          text: `${parts.join(' • ')}.`,
        });
        setRows([]);
        setMissingCariDrafts({});
      }
    } catch (err: unknown) {
      const msg = handleSupabaseError(err, 'Faturalar işlenirken hata oluştu.', {
        isFirmaUnlimited: Boolean(firma?.sinirsiz),
      });
      const lowerMsg = msg.toLowerCase();
      const isRls =
        lowerMsg.includes('rls') ||
        lowerMsg.includes('security') ||
        lowerMsg.includes('permission') ||
        lowerMsg.includes('yetki');
      setFeedback({
        type: 'error',
        text: msg,
        showSqlHint: isRls,
      });
      if (isRls) {
        setShowSqlHelp(true);
      }
    } finally {
      setImporting(false);
    }
  };

  const faturaSqlSnippet = `-- Opsiyonel: Fatura kalem ve vergi detaylarının farklı cihaz/tarayıcılarda da görünmesi için (~2 KB/fatura)
ALTER TABLE public.faturalar ADD COLUMN IF NOT EXISTS ubl_detay jsonb;

-- UYARI: Fatura bakiye tetikleyicisi veritabanında zaten kurulu; ikinci bir bakiye tetikleyicisi eklemeyiniz.`;

  const handleCopySql = () => {
    navigator.clipboard.writeText(faturaSqlSnippet);
    setCopiedSql(true);
    setTimeout(() => setCopiedSql(false), 2000);
  };

  if (!isOpen) return null;

  const confirmDisabled =
    importing || (cariRowsToInsert.length === 0 && giderRowsToPost.length === 0);

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
      <div className="bg-[#111820] border border-white/10 rounded-2xl w-full max-w-4xl max-h-[92vh] flex flex-col shadow-2xl overflow-hidden my-auto">
        {/* ÜST BAŞLIK */}
        <div className="p-4 sm:p-5 border-b border-white/[0.08] flex items-center justify-between gap-3 bg-black/20">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-teal-400/15 border border-teal-400/30 text-teal-400 flex items-center justify-center shrink-0">
              <FileCode2 className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm sm:text-base font-extrabold text-white">
                UBL / XML / ZIP Fatura Yükleme
              </h3>
              <p className="text-[11px] text-gray-400 mt-0.5">
                E-Fatura / E-Arşiv <code className="text-teal-300">.xml</code>,{' '}
                <code className="text-teal-300">.ubl</code> veya toplu{' '}
                <code className="text-teal-300">.zip</code> dosyalarını yükleyip cariye ve kasaya gider işleyin.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowSqlHelp(!showSqlHelp)}
              data-testid="ubl_sql_help_button"
              className="px-2.5 py-1.5 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 text-[11px] font-bold text-amber-300 flex items-center gap-1 transition"
              title="Supabase Veritabanı Trigger & RLS SQL Kodları"
            >
              <Code2 className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Veritabanı SQL</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Kapat"
              className="p-2 rounded-lg text-gray-400 hover:text-white hover:bg-white/5 transition"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* GÖVDE */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
          {/* FİRMA VKN BİLGİ ŞERİDİ */}
          <div className="p-3 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-start gap-2.5 text-[11px] text-blue-200">
            <Info className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
            <div className="leading-relaxed">
              Firmanızın Vergi/TC No bilgisi:{' '}
              <strong className="font-mono text-white">{firma?.vergi_no || 'Tanımsız'}</strong>.
              Satıcı VKN firmanızla eşleşirse{' '}
              <span className="text-teal-300 font-bold">Satış Faturası</span> (müşteri borçlanır),
              Alıcı VKN firmanızla eşleşirse{' '}
              <span className="text-orange-300 font-bold">Alış Faturası</span> (tedarikçi alacaklanır) olarak işlenir; gelen faturaları tek tıkla{' '}
              <span className="text-amber-300 font-bold">Giderleştir</span> ile seçtiğiniz kasadan gider olarak düşebilirsiniz.
            </div>
          </div>

          {/* OPSİYONEL VERİTABANI SQL YARDIMCISI */}
          {showSqlHelp && (
            <div className="p-4 rounded-xl bg-black/40 border border-amber-400/30 space-y-2.5">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div>
                  <h4 className="text-xs font-extrabold text-amber-300 flex items-center gap-1.5">
                    <Code2 className="w-4 h-4" />
                    <span>Supabase faturalar Trigger &amp; RLS SQL</span>
                  </h4>
                  <p className="text-[11px] text-gray-400 mt-0.5">
                    Supabase SQL Editor&apos;de bu komutu çalıştırarak fatura kalem detay desteğini açabilirsiniz.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleCopySql}
                  className="px-3 py-1.5 rounded-lg bg-amber-400 text-slate-950 text-xs font-extrabold flex items-center gap-1.5"
                >
                  {copiedSql ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copiedSql ? 'Kopyalandı' : 'SQL Kopyala'}</span>
                </button>
              </div>
              <pre className="p-3 rounded-xl bg-black/60 border border-white/10 text-[10px] font-mono text-teal-300 overflow-x-auto whitespace-pre-wrap">
                {faturaSqlSnippet}
              </pre>
            </div>
          )}

          {/* GERİ BİLDİRİM MESAJI */}
          {feedback && (
            <div
              className={`p-3.5 rounded-xl border text-xs flex items-start justify-between gap-3 ${
                feedback.type === 'success'
                  ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                  : 'bg-red-500/10 border-red-500/30 text-red-300'
              }`}
            >
              <div className="space-y-2 flex-1">
                <div className="flex items-start gap-2">
                  {feedback.type === 'success' ? (
                    <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                  ) : (
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  )}
                  <span className="leading-relaxed">{feedback.text}</span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setFeedback(null)}
                className="text-gray-400 hover:text-white shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* DOSYA / TOPLU ZIP DROPZONE */}
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setIsDragging(false);
              if (e.dataTransfer.files?.length) {
                processFiles(e.dataTransfer.files);
              }
            }}
            onClick={() => fileInputRef.current?.click()}
            data-testid="ubl_dropzone"
            className={`border-2 border-dashed rounded-2xl p-6 text-center cursor-pointer transition ${
              isDragging
                ? 'border-teal-400 bg-teal-400/10'
                : 'border-white/15 bg-black/20 hover:border-teal-400/50 hover:bg-black/30'
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".xml,.ubl,.zip,text/xml,application/xml,application/zip"
              multiple
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => {
                if (e.target.files?.length) {
                  processFiles(e.target.files);
                }
              }}
              className="hidden"
              data-testid="ubl_file_input"
            />
            <div className="w-12 h-12 rounded-2xl bg-teal-400/15 text-teal-400 flex items-center justify-center mx-auto mb-3">
              <Upload className="w-6 h-6" />
            </div>
            <div className="text-xs sm:text-sm font-bold text-white">
              {parsing
                ? 'Faturalar çözümleniyor...'
                : 'XML / UBL veya Toplu ZIP Arşivi Seçin / Sürükleyin'}
            </div>
            <p className="text-[11px] text-gray-400 mt-1">
              Birden fazla <span className="text-gray-200 font-semibold">.xml</span>,{' '}
              <span className="text-gray-200 font-semibold">.ubl</span> veya toplu{' '}
              <span className="text-teal-300 font-semibold">.zip</span> fatura paketini doğrudan yükleyebilirsiniz.
            </p>
          </div>

          {/* SİSTEMDE OLMAYAN CARİLER İÇİN DÜZENLENEBİLİR ONAY PANELİ */}
          {activeMissingCaris.length > 0 && (
            <div
              ref={missingPanelRef}
              data-testid="ubl_missing_cari_prompt_panel"
              className="p-4 rounded-2xl bg-amber-500/[0.08] border border-amber-400/35 space-y-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-start gap-2.5">
                  <div className="w-8 h-8 rounded-xl bg-amber-400/20 border border-amber-400/40 text-amber-300 flex items-center justify-center shrink-0">
                    <UserPlus className="w-4 h-4" />
                  </div>
                  <div>
                    <h4 className="text-xs sm:text-sm font-extrabold text-amber-200">
                      Sistemde Kayıtlı Olmayan Cariler Bulundu ({activeMissingCaris.length} adet)
                    </h4>
                    <p className="text-[11px] text-amber-100/80 mt-0.5">
                      Faturadaki bilgilerle yeni cari açmak için bilgileri kontrol edip onaylayın veya tek tıkla hemen açın.
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleApproveAllMissingCaris}
                  data-testid="ubl_approve_all_missing_caris_btn"
                  className="px-3 py-1.5 rounded-lg bg-amber-400 hover:bg-amber-300 text-slate-950 text-[11px] font-extrabold transition shrink-0"
                >
                  Tüm Yeni Carileri Onayla
                </button>
              </div>

              <div className="space-y-2.5">
                {activeMissingCaris.map(({ draft, invoiceNos }) => (
                  <div
                    key={draft.key}
                    className={`p-3 rounded-xl border space-y-2.5 transition ${
                      draft.approved
                        ? 'bg-emerald-500/[0.07] border-emerald-400/35'
                        : 'bg-[#0a0e13]/90 border-amber-400/30'
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <label className="inline-flex items-center gap-2 cursor-pointer text-xs font-bold text-white">
                        <input
                          type="checkbox"
                          checked={draft.approved}
                          onChange={(e) =>
                            updateMissingDraft(draft.key, { approved: e.target.checked })
                          }
                          data-testid={`ubl_missing_cari_approve_${draft.key}`}
                          className="w-4 h-4 accent-emerald-400 rounded cursor-pointer"
                        />
                        <span>Bu bilgilerle yeni cari açılsın</span>
                      </label>

                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[10px] text-gray-400">
                          Faturalar:{' '}
                          <strong className="font-mono text-teal-300">
                            {invoiceNos.join(', ')}
                          </strong>
                        </span>
                        <button
                          type="button"
                          disabled={draft.creating}
                          onClick={() => handleCreateSingleMissingCariNow(draft.key)}
                          data-testid={`ubl_create_single_cari_now_${draft.key}`}
                          className="px-2.5 py-1 rounded-lg bg-teal-400/15 hover:bg-teal-400/25 border border-teal-400/35 text-teal-300 text-[11px] font-bold flex items-center gap-1 transition disabled:opacity-50"
                        >
                          <UserPlus className="w-3 h-3" />
                          <span>{draft.creating ? 'Açılıyor...' : 'Cariyi Şimdi Aç'}</span>
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-2">
                      <div className="lg:col-span-2">
                        <label className="block text-[10px] font-semibold text-gray-400 mb-0.5">
                          Cari Unvanı *
                        </label>
                        <input
                          type="text"
                          value={draft.unvan}
                          onChange={(e) =>
                            updateMissingDraft(draft.key, { unvan: e.target.value })
                          }
                          className="w-full bg-[#111820] border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-teal-400"
                        />
                      </div>

                      <div>
                        <label className="block text-[10px] font-semibold text-gray-400 mb-0.5">
                          VKN / TCKN
                        </label>
                        <input
                          type="text"
                          value={draft.vergiTcNo}
                          onChange={(e) =>
                            updateMissingDraft(draft.key, { vergiTcNo: e.target.value })
                          }
                          className="w-full bg-[#111820] border border-white/10 rounded-lg px-2.5 py-1.5 text-xs font-mono text-white focus:outline-none focus:border-teal-400"
                        />
                      </div>

                      <div>
                        <label className="block text-[10px] font-semibold text-gray-400 mb-0.5">
                          Cari Türü
                        </label>
                        <select
                          value={draft.tur}
                          onChange={(e) =>
                            updateMissingDraft(draft.key, { tur: e.target.value as CariTur })
                          }
                          className="w-full bg-[#111820] border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-teal-400"
                        >
                          <option value="alici">Alıcı (Müşteri)</option>
                          <option value="tedarikci">Tedarikçi</option>
                        </select>
                      </div>

                      <div>
                        <label className="block text-[10px] font-semibold text-gray-400 mb-0.5">
                          Telefon
                        </label>
                        <input
                          type="text"
                          value={draft.telefon}
                          onChange={(e) =>
                            updateMissingDraft(draft.key, { telefon: e.target.value })
                          }
                          placeholder="05XX..."
                          className="w-full bg-[#111820] border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-teal-400"
                        />
                      </div>

                      <div>
                        <label className="block text-[10px] font-semibold text-gray-400 mb-0.5">
                          E-posta
                        </label>
                        <input
                          type="email"
                          value={draft.email}
                          onChange={(e) =>
                            updateMissingDraft(draft.key, { email: e.target.value })
                          }
                          placeholder="ornek@firma.com"
                          className="w-full bg-[#111820] border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-teal-400"
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TOPLU GİDERLEŞTİRME ARAÇ ÇUBUĞU (GELEN / ALIŞ FATURALARI VARSA) */}
          {incomingEligibleRows.length > 0 && (
            <div
              data-testid="ubl_bulk_gider_toolbar"
              className="p-3.5 rounded-2xl bg-orange-500/[0.07] border border-orange-400/30 flex flex-col lg:flex-row lg:items-center justify-between gap-3"
            >
              <div className="flex items-start gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-orange-400/20 border border-orange-400/35 text-orange-300 flex items-center justify-center shrink-0">
                  <Receipt className="w-4 h-4" />
                </div>
                <div>
                  <div className="text-xs font-extrabold text-orange-200">
                    Gelen Faturaları Giderleştir (Cari + Seçilen Kasaya Gider)
                  </div>
                  <p className="text-[11px] text-gray-300 mt-0.5">
                    İşaretlenen alış faturaları cariye işlenirken aynı anda seçilen kasadan gider düşülür.
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={bulkGiderKasaId}
                  onChange={(e) =>
                    handleApplyBulkKasaAndKategori(e.target.value, bulkGiderKategori)
                  }
                  data-testid="ubl_default_gider_kasa_select"
                  className="bg-[#0a0e13] border border-white/15 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-orange-400"
                >
                  {kasalar.length === 0 ? (
                    <option value="">Otomatik Varsayılan Nakit Kasa</option>
                  ) : (
                    kasalar.map((k) => (
                      <option key={k.id} value={k.id}>
                        Kasa: {k.ad} ({formatCurrency(Number(k.guncel_bakiye) || 0)})
                      </option>
                    ))
                  )}
                </select>

                <select
                  value={bulkGiderKategori}
                  onChange={(e) =>
                    handleApplyBulkKasaAndKategori(bulkGiderKasaId, e.target.value)
                  }
                  data-testid="ubl_default_gider_kategori_select"
                  className="bg-[#0a0e13] border border-white/15 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-orange-400"
                >
                  {FATURA_GIDER_KATEGORILERI.map((kat) => (
                    <option key={kat} value={kat}>
                      Kategori: {kat}
                    </option>
                  ))}
                </select>

                <button
                  type="button"
                  onClick={() => handleBulkToggleGiderlestir(!allIncomingGiderChecked)}
                  data-testid="ubl_bulk_giderlestir_btn"
                  className={`px-3 py-1.5 rounded-lg text-xs font-extrabold transition ${
                    allIncomingGiderChecked
                      ? 'bg-orange-400 text-[#0a0e13]'
                      : 'bg-orange-400/20 hover:bg-orange-400/30 border border-orange-400/40 text-orange-200'
                  }`}
                >
                  {allIncomingGiderChecked
                    ? 'Tüm Giderleştirmeleri Kaldır'
                    : `Gelen Faturaları Giderleştir (${incomingEligibleRows.length})`}
                </button>
              </div>
            </div>
          )}

          {/* ÇÖZÜMLENEN FATURALAR LİSTESİ */}
          {rows.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <h4 className="text-xs font-extrabold uppercase tracking-wider text-gray-300">
                  Önizleme ve Cari Eşleştirme ({rows.length} kayıt)
                </h4>
                <button
                  type="button"
                  onClick={() => {
                    setRows([]);
                    setMissingCariDrafts({});
                  }}
                  className="text-[11px] text-gray-400 hover:text-red-400 font-semibold transition"
                >
                  Listeyi Temizle
                </button>
              </div>

              <div className="space-y-2.5">
                {rows.map((row) => {
                  if (row.error || !row.parsed) {
                    return (
                      <div
                        key={row.id}
                        className="p-3.5 rounded-xl bg-red-500/10 border border-red-500/30 flex items-center justify-between gap-3 text-xs"
                      >
                        <div className="flex items-center gap-2 text-red-300 min-w-0">
                          <AlertCircle className="w-4 h-4 shrink-0" />
                          <span className="truncate">{row.error || `${row.fileName} hatalı`}</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleRemoveRow(row.id)}
                          className="p-1.5 text-red-300 hover:bg-red-500/20 rounded-lg shrink-0"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    );
                  }

                  const p = row.parsed;
                  const counterparty = row.yon === 'satis' ? p.customer : p.supplier;
                  const matchedExisting = allCariler.find((c) => c.id === row.selectedCariId);
                  const isAutoCreate = row.selectedCariId === AUTO_CREATE_VALUE;
                  const missingKey = row.missingCariKey || buildPartyDedupKey(counterparty);
                  const missingDraft = missingKey ? missingCariDrafts[missingKey] : undefined;
                  const isMissingApproved = Boolean(missingDraft?.approved);
                  const isForeign = p.currencyCode !== 'TRY' && p.currencyCode !== 'TL';
                  const rowActive = row.include || (row.yon === 'alis' && row.giderlestir);

                  return (
                    <div
                      key={row.id}
                      className={`p-3.5 sm:p-4 rounded-xl border transition space-y-3 ${
                        rowActive
                          ? 'bg-[#0a0e13] border-teal-500/30'
                          : 'bg-black/20 border-white/[0.06] opacity-75'
                      }`}
                    >
                      {/* Satır Üst Başlık */}
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <input
                            type="checkbox"
                            checked={row.include}
                            disabled={row.isDuplicate}
                            onChange={() => handleToggleInclude(row.id)}
                            aria-label={`${p.faturaNo} faturasını cariye aktar`}
                            className="w-4 h-4 accent-teal-400 rounded cursor-pointer disabled:opacity-40"
                          />
                          <div>
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-mono text-xs font-extrabold text-teal-400">
                                {p.faturaNo}
                              </span>
                              <span className="text-[11px] text-gray-400">
                                {formatDate(p.tarih)}
                              </span>
                              {row.source === 'zip' && (
                                <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-indigo-500/15 text-indigo-300 border border-indigo-500/30">
                                  ZIP
                                </span>
                              )}
                              {p.invoiceTypeCode === 'IADE' && (
                                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                                  İADE FATURASI
                                </span>
                              )}
                              {row.isDuplicate && (
                                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-red-500/15 text-red-300 border border-red-500/30">
                                  Cariye Kayıtlı
                                </span>
                              )}
                              {row.alreadyExpenseSynced && (
                                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                                  Kasaya Gider İşli
                                </span>
                              )}
                            </div>
                            <div className="text-[10px] text-gray-500 truncate mt-0.5">
                              Kaynak: {row.fileName} • {p.detectionReason}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 flex-wrap">
                          {showInvoicePreview && (
                            <button
                              type="button"
                              onClick={() => setPreviewRow({ parsed: p, yon: row.yon })}
                              data-testid="ubl_preview_invoice_btn"
                              className="px-2.5 py-1 rounded-lg bg-blue-500/15 hover:bg-blue-500/25 border border-blue-500/30 text-[11px] font-bold text-blue-300 flex items-center gap-1 transition"
                              title="Faturanın görsel e-Fatura önizlemesini aç (Sadece Web)"
                            >
                              <Eye className="w-3.5 h-3.5" />
                              <span>Fatura Görüntüsü</span>
                            </button>
                          )}

                          <div className="inline-flex rounded-lg bg-black/50 p-0.5 border border-white/10">
                            <button
                              type="button"
                              onClick={() => handleYonChange(row.id, 'satis')}
                              className={`px-2.5 py-1 rounded-md text-[11px] font-bold flex items-center gap-1 transition ${
                                row.yon === 'satis'
                                  ? 'bg-teal-400 text-[#0a0e13]'
                                  : 'text-gray-400 hover:text-white'
                              }`}
                            >
                              <ArrowUpRight className="w-3 h-3" />
                              <span>Satış</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => handleYonChange(row.id, 'alis')}
                              className={`px-2.5 py-1 rounded-md text-[11px] font-bold flex items-center gap-1 transition ${
                                row.yon === 'alis'
                                  ? 'bg-orange-400 text-[#0a0e13]'
                                  : 'text-gray-400 hover:text-white'
                              }`}
                            >
                              <ArrowDownLeft className="w-3 h-3" />
                              <span>Alış</span>
                            </button>
                          </div>

                          <button
                            type="button"
                            onClick={() => handleRemoveRow(row.id)}
                            title="Listeden çıkar"
                            className="p-1.5 text-gray-400 hover:text-red-400 rounded-lg hover:bg-red-500/10 transition"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>

                      {/* Satır Detay: Karşı Taraf + Cari + Tutar */}
                      <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-start pt-2 border-t border-white/[0.05]">
                        <div className="md:col-span-4 space-y-1">
                          <div className="text-[10px] uppercase font-bold text-gray-400">
                            {row.yon === 'satis' ? 'Alıcı (Müşteri)' : 'Satıcı (Tedarikçi)'}
                          </div>
                          <div className="text-xs font-bold text-white leading-snug">
                            {counterparty.unvan}
                          </div>
                          <div className="text-[11px] font-mono text-teal-300">
                            VKN/TCKN: {counterparty.vkn || 'Bulunamadı'}
                          </div>
                        </div>

                        <div className="md:col-span-5 space-y-1">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[10px] uppercase font-bold text-gray-400">
                              İşleneceği Cari Hesap
                            </span>
                            {matchedExisting ? (
                              <span className="inline-flex items-center gap-1 text-[10px] font-bold text-teal-400">
                                <Building2 className="w-3 h-3" />
                                VKN / Cari Eşleşti
                              </span>
                            ) : isAutoCreate ? (
                              isMissingApproved ? (
                                <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-300">
                                  <CheckCircle2 className="w-3 h-3" />
                                  Onaylandı (Yeni Açılacak)
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-300">
                                  <UserPlus className="w-3 h-3" />
                                  Cari Yok — Yukarıdan Onaylayın
                                </span>
                              )
                            ) : null}
                          </div>
                          <select
                            value={row.selectedCariId}
                            disabled={row.isDuplicate}
                            onChange={(e) => handleCariChange(row.id, e.target.value)}
                            className={`w-full bg-[#111820] border rounded-lg px-2.5 py-2 text-xs text-white focus:outline-none focus:border-teal-400 disabled:opacity-50 ${
                              isAutoCreate && !isMissingApproved && !row.isDuplicate
                                ? 'border-amber-400/50'
                                : 'border-white/10'
                            }`}
                          >
                            <option value="">-- Cari Seçiniz --</option>
                            <option value={AUTO_CREATE_VALUE}>
                              + Faturadaki Bilgilerle Yeni Cari Aç ({counterparty.unvan} -{' '}
                              {counterparty.vkn || 'VKN Yok'})
                            </option>
                            {allCariler.map((c) => (
                              <option key={c.id} value={c.id}>
                                [{c.tur === 'alici' ? 'ALICI' : 'TEDARİKÇİ'}] {c.unvan}
                                {c.vergi_tc_no ? ` (${c.vergi_tc_no})` : ''}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div className="md:col-span-3 space-y-1">
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] uppercase font-bold text-gray-400">
                              TL Tutarı
                            </span>
                            {isForeign && (
                              <span className="text-[10px] font-mono text-amber-300">
                                {p.originalAmount.toLocaleString('tr-TR', {
                                  minimumFractionDigits: 2,
                                  maximumFractionDigits: 2,
                                })}{' '}
                                {p.currencyCode}
                              </span>
                            )}
                          </div>
                          {isForeign ? (
                            <div className="grid grid-cols-2 gap-1.5">
                              <input
                                type="number"
                                step="0.0001"
                                value={row.exchangeRate}
                                onChange={(e) => handleExchangeRateChange(row.id, e.target.value)}
                                title="Döviz Kuru"
                                placeholder="Kur"
                                className="w-full bg-[#111820] border border-white/10 rounded-lg px-2 py-1.5 text-xs font-mono text-amber-300 focus:outline-none focus:border-teal-400"
                              />
                              <input
                                type="number"
                                step="0.01"
                                value={row.tutarTL}
                                onChange={(e) => handleTutarChange(row.id, e.target.value)}
                                title="TL Karşılığı"
                                className="w-full bg-[#111820] border border-white/10 rounded-lg px-2 py-1.5 text-xs font-mono font-bold text-white text-right focus:outline-none focus:border-teal-400"
                              />
                            </div>
                          ) : (
                            <input
                              type="number"
                              step="0.01"
                              value={row.tutarTL}
                              onChange={(e) => handleTutarChange(row.id, e.target.value)}
                              className="w-full bg-[#111820] border border-white/10 rounded-lg px-2.5 py-1.5 text-xs font-mono font-bold text-white text-right focus:outline-none focus:border-teal-400"
                            />
                          )}
                          <div className="text-[10px] text-right text-gray-400">
                            Cari Etki:{' '}
                            <span
                              className={
                                row.yon === 'satis' ? 'text-teal-400 font-bold' : 'text-red-400 font-bold'
                              }
                            >
                              {row.yon === 'satis' ? '+' : '-'}
                              {formatCurrency(row.tutarTL)}
                            </span>
                          </div>
                          {matchedExisting && row.yon === 'satis' && (() => {
                            const limit = getEffectiveCariRiskLimit(matchedExisting, firma?.id);
                            if (!limit) return null;
                            const risk = evaluateCariRiskStatus({
                              currentBakiye: Number(matchedExisting.bakiye) || 0,
                              pendingDelta: row.tutarTL,
                              riskLimit: limit,
                            });
                            if (risk.level !== 'warning' && risk.level !== 'exceeded') return null;
                            return (
                              <div
                                data-testid={`ubl_risk_warning_${row.id}`}
                                className={`text-[10px] font-bold px-2 py-1 rounded-lg border text-right ${
                                  risk.level === 'exceeded'
                                    ? 'bg-rose-500/15 border-rose-500/30 text-rose-300'
                                    : 'bg-amber-500/15 border-amber-500/30 text-amber-300'
                                }`}
                              >
                                Risk Limiti %{risk.percent} ({formatCurrency(risk.projectedBakiye)} /{' '}
                                {formatCurrency(risk.riskLimit)})
                              </div>
                            );
                          })()}
                        </div>
                      </div>

                      {/* GELEN (ALIŞ) FATURA İÇİN GİDERLEŞTİR SEÇENEĞİ */}
                      {row.yon === 'alis' && !row.alreadyExpenseSynced && (
                        <div className="pt-2 border-t border-white/[0.06] flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 bg-orange-500/[0.04] rounded-xl px-3 py-2">
                          <label className="inline-flex items-center gap-2 cursor-pointer text-xs font-bold text-orange-200">
                            <input
                              type="checkbox"
                              checked={row.giderlestir}
                              onChange={() => handleToggleGiderlestir(row.id)}
                              data-testid={`ubl_row_giderlestir_${row.id}`}
                              className="w-4 h-4 accent-orange-400 rounded cursor-pointer"
                            />
                            <Receipt className="w-3.5 h-3.5 text-orange-400" />
                            <span>
                              Giderleştir ({row.isDuplicate ? 'Sadece Seçilen Kasaya Gider' : 'Cari + Seçilen Kasaya Gider'})
                            </span>
                          </label>

                          {row.giderlestir && (
                            <div className="flex flex-wrap items-center gap-2">
                              <select
                                value={row.kasaId || bulkGiderKasaId}
                                onChange={(e) =>
                                  handleRowGiderPatch(row.id, { kasaId: e.target.value })
                                }
                                data-testid={`ubl_row_kasa_${row.id}`}
                                className="bg-[#111820] border border-orange-400/35 rounded-lg px-2 py-1 text-[11px] text-white focus:outline-none focus:border-orange-400"
                              >
                                {kasalar.length === 0 ? (
                                  <option value="">Varsayılan Nakit Kasa</option>
                                ) : (
                                  kasalar.map((k) => (
                                    <option key={k.id} value={k.id}>
                                      {k.ad}
                                    </option>
                                  ))
                                )}
                              </select>
                              <select
                                value={row.giderKategori || bulkGiderKategori}
                                onChange={(e) =>
                                  handleRowGiderPatch(row.id, { giderKategori: e.target.value })
                                }
                                data-testid={`ubl_row_kategori_${row.id}`}
                                className="bg-[#111820] border border-orange-400/35 rounded-lg px-2 py-1 text-[11px] text-white focus:outline-none focus:border-orange-400"
                              >
                                {FATURA_GIDER_KATEGORILERI.map((kat) => (
                                  <option key={kat} value={kat}>
                                    {kat}
                                  </option>
                                ))}
                              </select>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* ALT BİLGİ & KAYDET */}
        <div className="p-4 sm:p-5 border-t border-white/[0.08] bg-black/25 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="text-xs text-gray-400">
            {cariRowsToInsert.length > 0 || giderRowsToPost.length > 0 ? (
              <span>
                {cariRowsToInsert.length > 0 && (
                  <>
                    <strong className="text-white">{cariRowsToInsert.length} fatura</strong> cariye işlenecek
                  </>
                )}
                {cariRowsToInsert.length > 0 && giderRowsToPost.length > 0 && ' • '}
                {giderRowsToPost.length > 0 && (
                  <strong className="text-orange-300">
                    {giderRowsToPost.length} fatura kasaya gider işlenecek
                  </strong>
                )}
                {approvedNewCariCount > 0 && (
                  <>
                    {' • '}
                    <strong className="text-emerald-300">{approvedNewCariCount} yeni cari</strong> açılacak
                  </>
                )}
                {unapprovedSelectedMissingKeys.length > 0 && (
                  <>
                    {' • '}
                    <strong className="text-amber-300">
                      {unapprovedSelectedMissingKeys.length} yeni cari onay bekliyor
                    </strong>
                  </>
                )}
              </span>
            ) : (
              <span>Yüklemek için yukarıdan .xml, .ubl veya .zip fatura dosyası seçiniz.</span>
            )}
          </div>

          <div className="flex items-center justify-end gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 rounded-xl border border-white/10 text-gray-300 hover:bg-white/5 text-xs font-semibold transition"
            >
              Kapat
            </button>
            <button
              type="button"
              disabled={confirmDisabled}
              onClick={handleImportConfirm}
              data-testid="ubl_import_confirm_button"
              className="px-5 py-2.5 rounded-xl bg-teal-400 hover:bg-teal-300 disabled:opacity-40 text-[#0a0e13] font-extrabold text-xs flex items-center gap-2 shadow-[0_0_20px_rgba(45,212,191,0.25)] transition"
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>
                {importing
                  ? 'İşleniyor...'
                  : cariRowsToInsert.length > 0 && giderRowsToPost.length > 0
                  ? `${cariRowsToInsert.length} Cari + ${giderRowsToPost.length} Gider İşle`
                  : giderRowsToPost.length > 0
                  ? `${giderRowsToPost.length} Faturayı Kasaya Gider İşle`
                  : `${cariRowsToInsert.length} Faturayı Cariye İşle`}
              </span>
            </button>
          </div>
        </div>
      </div>

      {showInvoicePreview && previewRow && (
        <UblInvoicePreviewModal
          isOpen={Boolean(previewRow)}
          invoice={previewRow.parsed}
          yon={previewRow.yon}
          firmaVergiNo={firma?.vergi_no}
          onClose={() => setPreviewRow(null)}
        />
      )}
    </div>
  );
};
