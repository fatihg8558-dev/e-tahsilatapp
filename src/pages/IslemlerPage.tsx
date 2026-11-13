import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { supabase, handleSupabaseError } from '../lib/supabase';
import { Islem, IslemDurum, IslemTip } from '../types/database';
import { formatCurrency, formatDate } from '../lib/formatters';
import {
  ReceiptText,
  Search,
  Filter,
  Calendar,
  ArrowDownLeft,
  ArrowUpRight,
  User,
  AlertCircle,
  Eye,
  EyeOff,
  ChevronRight,
  FileSpreadsheet,
  Printer,
  Pencil,
  Trash2,
} from 'lucide-react';
import { exportToExcel, printPdfReport } from '../lib/exportService';
import { extractKarmaRef, isKarmaAciklama } from '../lib/karmaReceiptHelper';
import { DeleteReceiptConfirmModal } from '../components/makbuz/DeleteReceiptConfirmModal';

interface IslemlerPageProps {
  onOpenMakbuz: (islem: Islem) => void;
  onEditIslem?: (islem: Islem) => void;
  onNavigate: (tab: string) => void;
  refreshKey?: number;
}

export const IslemlerPage: React.FC<IslemlerPageProps> = ({
  onOpenMakbuz,
  onEditIslem,
  onNavigate,
  refreshKey = 0,
}) => {
  const { profile, firma } = useAuth();
  const [islemler, setIslemler] = useState<Islem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filtreler
  const [tipFilter, setTipFilter] = useState<'all' | IslemTip>('all');
  const [durumFilter, setDurumFilter] = useState<'all' | IslemDurum>('all');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [hideCancelled, setHideCancelled] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [islemToDelete, setIslemToDelete] = useState<Islem | null>(null);

  const fetchIslemler = async () => {
    if (!firma?.id) return;

    try {
      setLoading(true);
      setError(null);

      let query = supabase
        .from('islemler')
        .select('*, cariler:cari_id(unvan, vergi_tc_no, telefon, email), profiles:yapan_user_id(ad_soyad)')
        .eq('firma_id', firma.id)
        .order('tarih', { ascending: false })
        .order('id', { ascending: false });

      // Plasiyer sadece kendi işlemlerini görür
      if (profile?.rol === 'plasiyer') {
        query = query.eq('yapan_user_id', profile.id);
      }

      if (tipFilter !== 'all') {
        query = query.eq('tip', tipFilter);
      }

      if (durumFilter !== 'all') {
        query = query.eq('durum', durumFilter);
      }

      if (startDate) {
        query = query.gte('tarih', startDate);
      }

      if (endDate) {
        query = query.lte('tarih', endDate);
      }

      const { data, error: err } = await query;

      if (err) throw err;
      setIslemler((data as Islem[]) || []);
    } catch (err: unknown) {
      setError(handleSupabaseError(err, 'İşlemler yüklenirken hata oluştu.'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchIslemler();
  }, [firma?.id, tipFilter, durumFilter, startDate, endDate, profile?.id, refreshKey]);

  // Arama ve İptal Gizleme
  const filteredIslemler = islemler.filter((islem) => {
    if (hideCancelled && islem.iptal) return false;

    const q = searchQuery.toLowerCase().trim();
    if (!q) return true;

    const cariUnvan = islem.cariler?.unvan?.toLowerCase() || '';
    const makbuzNo = islem.makbuz_no?.toLowerCase() || '';
    const aciklama = islem.aciklama?.toLowerCase() || '';
    const yapan = islem.profiles?.ad_soyad?.toLowerCase() || '';

    return cariUnvan.includes(q) || makbuzNo.includes(q) || aciklama.includes(q) || yapan.includes(q);
  });

  const handleExportExcel = () => {
    const headers = [
      'Tarih',
      'Makbuz No',
      'Cari Unvanı',
      'VKN/TCKN',
      'İşlem Tipi',
      'Ödeme Türü',
      'Belge No',
      'Banka',
      'Vade',
      'Durum',
      'İşlemi Yapan',
      'Açıklama',
      'Tutar (TL)',
    ];
    const rows = filteredIslemler.map((i) => [
      formatDate(i.tarih),
      i.makbuz_no || `#${i.id.slice(0, 8)}`,
      i.cariler?.unvan || '-',
      i.cariler?.vergi_tc_no || '-',
      i.tip.toUpperCase(),
      i.tur.toUpperCase(),
      i.belge_no || '-',
      i.banka_adi || '-',
      i.vade ? formatDate(i.vade) : '-',
      i.iptal ? 'İPTAL' : i.durum.toUpperCase(),
      i.profiles?.ad_soyad || 'Yönetici',
      i.aciklama || '-',
      Number(i.tutar) || 0,
    ]);
    const today = new Date().toISOString().split('T')[0];
    exportToExcel(`islem_gecmisi_${today}`, headers, rows);
  };

  const handleExportPdf = () => {
    const headers = [
      'Tarih',
      'Makbuz No',
      'Cari Unvanı',
      'Tür / Tip',
      'Durum',
      'Tutar',
    ];
    let totalTahsilat = 0;
    let totalTediye = 0;

    const rows = filteredIslemler.map((i) => {
      const tutar = Number(i.tutar) || 0;
      if (!i.iptal) {
        if (i.tip === 'tahsilat') totalTahsilat += tutar;
        else if (i.tip === 'tediye') totalTediye += tutar;
      }
      return [
        formatDate(i.tarih),
        i.makbuz_no || `#${i.id.slice(0, 8)}`,
        i.cariler?.unvan || '-',
        `${i.tur.toUpperCase()} (${i.tip.toUpperCase()})`,
        i.iptal ? 'İPTAL' : i.durum.toUpperCase(),
        formatCurrency(tutar),
      ];
    });

    const summary = [
      { label: 'İşlem Sayısı', value: `${filteredIslemler.length} Kayıt` },
      { label: 'Toplam Tahsilat', value: formatCurrency(totalTahsilat) },
      { label: 'Toplam Tediye', value: formatCurrency(totalTediye) },
      { label: 'Net Bakiye Farkı', value: formatCurrency(totalTahsilat - totalTediye) },
    ];

    printPdfReport(
      `${firma?.unvan || 'FİRMA'} - İŞLEM GEÇMİŞİ VE MAKBUZ RAPORU`,
      `Filtre: ${tipFilter !== 'all' ? tipFilter.toUpperCase() : 'TÜM TİPLER'} | Tarih: ${startDate || 'Başlangıç'} - ${endDate || 'Bugün'}`,
      headers,
      rows,
      summary
    );
  };

  return (
    <div className="space-y-6">
      {/* BAŞLIK & EYEBROW */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-teal-500/10 border border-teal-500/20 text-teal-400 text-[11px] font-semibold uppercase tracking-wider mb-2">
            <ReceiptText className="w-3 h-3" />
            <span>Kayıt Defteri</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">İşlem Listesi</h1>
          <p className="text-xs text-gray-400 mt-1">
            Tüm tahsilat ve tediye makbuzlarını filtreleyin, detayları ve iptal durumlarını inceleyin
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* DIŞA AKTAR BUTONLARI */}
          <button
            onClick={handleExportExcel}
            className="bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border border-emerald-500/30 font-bold text-xs px-3 py-2.5 rounded-xl transition flex items-center gap-1.5"
            title="Filtrelenen İşlemleri Excel Olarak İndir"
          >
            <FileSpreadsheet className="w-4 h-4 text-emerald-400" />
            <span>Excel</span>
          </button>
          <button
            onClick={handleExportPdf}
            className="bg-teal-500/15 hover:bg-teal-500/25 text-teal-300 border border-teal-500/30 font-bold text-xs px-3 py-2.5 rounded-xl transition flex items-center gap-1.5"
            title="Filtrelenen İşlemleri PDF Olarak Yazdır"
          >
            <Printer className="w-4 h-4 text-teal-400" />
            <span>PDF</span>
          </button>

          {profile?.rol !== 'muhasebeci' && (
            <>
              <button
                onClick={() => onNavigate('tahsilat')}
                className="bg-teal-400 hover:bg-teal-300 text-[#0a0e13] font-bold text-xs px-3.5 py-2.5 rounded-xl transition shadow-[0_0_15px_rgba(45,212,191,0.2)] flex items-center gap-1.5"
              >
                <ArrowDownLeft className="w-4 h-4" />
                <span>Yeni Tahsilat</span>
              </button>
              <button
                onClick={() => onNavigate('tediye')}
                className="bg-orange-500/20 hover:bg-orange-500/30 text-orange-400 border border-orange-500/30 font-bold text-xs px-3.5 py-2.5 rounded-xl transition flex items-center gap-1.5"
              >
                <ArrowUpRight className="w-4 h-4" />
                <span>Yeni Tediye</span>
              </button>
            </>
          )}
        </div>
      </div>

      {error && (
        <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs flex items-center gap-2.5">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* FİLTRELEME ÇUBUĞU */}
      <div className="bg-[#111820] border border-white/[0.07] rounded-2xl p-4 sm:p-5 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 text-xs">
          {/* Arama */}
          <div className="relative lg:col-span-2">
            <Search className="w-4 h-4 absolute left-3.5 top-3 text-gray-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Cari, makbuz no veya açıklama ara..."
              className="w-full bg-[#0a0e13] border border-white/10 rounded-xl pl-9 pr-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-teal-400"
            />
          </div>

          {/* İşlem Tipi Filtresi */}
          <div>
            <select
              value={tipFilter}
              onChange={(e) => setTipFilter(e.target.value as any)}
              className="w-full bg-[#0a0e13] border border-white/10 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-teal-400"
            >
              <option value="all">Tüm Tipler (Tahsilat/Tediye)</option>
              <option value="tahsilat">Sadece Tahsilatlar</option>
              <option value="tediye">Sadece Tediyeler</option>
            </select>
          </div>

          {/* Durum Filtresi: 'aktif', 'plasiyerde', 'aktarildi' */}
          <div>
            <select
              value={durumFilter}
              onChange={(e) => setDurumFilter(e.target.value as any)}
              className="w-full bg-[#0a0e13] border border-white/10 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-teal-400"
            >
              <option value="all">Tüm Durumlar</option>
              <option value="aktif">Aktif</option>
              <option value="plasiyerde">Plasiyerde (Aktarılmamış)</option>
              <option value="aktarildi">Merkeze Aktarıldı</option>
            </select>
          </div>

          {/* İptalleri Gizle Anahtarı */}
          <div className="flex items-center">
            <button
              type="button"
              onClick={() => setHideCancelled(!hideCancelled)}
              className={`w-full py-2 px-3 rounded-xl border flex items-center justify-center gap-2 font-semibold transition ${
                hideCancelled
                  ? 'bg-teal-500/10 border-teal-500/30 text-teal-400'
                  : 'bg-black/30 border-white/10 text-gray-300 hover:text-white'
              }`}
            >
              {hideCancelled ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              <span>İptalleri Gizle</span>
            </button>
          </div>
        </div>

        {/* Tarih Aralığı */}
        <div className="flex flex-wrap items-center gap-3 pt-3 border-t border-white/[0.05] text-xs">
          <span className="text-gray-400 font-semibold flex items-center gap-1.5">
            <Calendar className="w-3.5 h-3.5 text-teal-400" />
            <span>Tarih Aralığı:</span>
          </span>

          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="bg-[#0a0e13] border border-white/10 rounded-lg px-2.5 py-1.5 text-white focus:outline-none focus:border-teal-400"
          />
          <span className="text-gray-500">-</span>
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="bg-[#0a0e13] border border-white/10 rounded-lg px-2.5 py-1.5 text-white focus:outline-none focus:border-teal-400"
          />

          {(startDate || endDate || tipFilter !== 'all' || durumFilter !== 'all' || searchQuery) && (
            <button
              onClick={() => {
                setStartDate('');
                setEndDate('');
                setTipFilter('all');
                setDurumFilter('all');
                setSearchQuery('');
              }}
              className="text-gray-400 hover:text-teal-400 font-semibold underline ml-auto"
            >
              Filtreleri Temizle
            </button>
          )}
        </div>
      </div>

      {/* İŞLEM TABLOSU / MOBİL LİSTE */}
      <div className="bg-[#111820] border border-white/[0.07] rounded-2xl overflow-hidden shadow-xl">
        {loading ? (
          <div className="p-12 text-center text-xs text-gray-400">İşlemler listeleniyor...</div>
        ) : filteredIslemler.length === 0 ? (
          <div className="p-12 text-center">
            <ReceiptText className="w-10 h-10 text-gray-600 mx-auto mb-2" />
            <p className="text-xs text-gray-400">Belirtilen filtrelere uygun işlem bulunamadı.</p>
          </div>
        ) : (
          <div>
            {/* MASAÜSTÜ TABLO */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-white/[0.06] bg-black/20 text-gray-400 text-[11px] uppercase tracking-wider font-semibold">
                    <th className="py-3 px-5">Tarih</th>
                    <th className="py-3 px-4">Makbuz No</th>
                    <th className="py-3 px-4">Cari Unvanı</th>
                    <th className="py-3 px-4">Tip</th>
                    <th className="py-3 px-4">Ödeme Türü</th>
                    <th className="py-3 px-4">İşlemi Yapan</th>
                    <th className="py-3 px-4">Durum</th>
                    <th className="py-3 px-5 text-right">Tutar (₺)</th>
                    <th className="py-3 px-4 text-right">İşlem</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.04]">
                  {filteredIslemler.map((islem) => (
                    <tr
                      key={islem.id}
                      onClick={() => onOpenMakbuz(islem)}
                      className="hover:bg-white/[0.03] transition cursor-pointer group"
                    >
                      <td className="py-3.5 px-5 text-gray-300 whitespace-nowrap">
                        {formatDate(islem.tarih)}
                      </td>
                      <td className="py-3.5 px-4 font-mono font-semibold text-teal-400 whitespace-nowrap">
                        {islem.makbuz_no || `#${islem.id.slice(0, 8)}`}
                      </td>
                      <td className="py-3.5 px-4 font-semibold text-white max-w-[220px] truncate">
                        {islem.cariler?.unvan || 'Cari Belirtilmemiş'}
                      </td>
                      <td className="py-3.5 px-4">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                            islem.tip === 'tahsilat'
                              ? 'bg-teal-500/10 text-teal-400 border border-teal-500/20'
                              : 'bg-orange-500/10 text-orange-400 border border-orange-500/20'
                          }`}
                        >
                          {islem.tip}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-gray-300 capitalize">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span>{islem.tur.replace('_', ' ')}</span>
                          {isKarmaAciklama(islem.aciklama) && (
                            <span className="px-1.5 py-0.5 rounded bg-cyan-500/15 border border-cyan-500/30 text-cyan-300 text-[9px] font-bold uppercase">
                              {extractKarmaRef(islem.aciklama) ? `Karma • ${extractKarmaRef(islem.aciklama)}` : 'Karma'}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-3.5 px-4 text-gray-400">
                        {islem.profiles?.ad_soyad || 'Merkez'}
                      </td>
                      <td className="py-3.5 px-4">
                        {islem.iptal ? (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-500/15 text-red-400 border border-red-500/30">
                            İPTAL EDİLDİ
                          </span>
                        ) : (
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${
                              islem.durum === 'aktif'
                                ? 'bg-emerald-500/10 text-emerald-400'
                                : islem.durum === 'plasiyerde'
                                ? 'bg-amber-500/10 text-amber-400'
                                : 'bg-blue-500/10 text-blue-400'
                            }`}
                          >
                            {islem.durum}
                          </span>
                        )}
                      </td>
                      <td
                        className={`py-3.5 px-5 text-right font-bold text-sm whitespace-nowrap ${
                          islem.iptal
                            ? 'line-through text-gray-500'
                            : islem.tip === 'tahsilat'
                            ? 'text-teal-400'
                            : 'text-orange-400'
                        }`}
                      >
                        {formatCurrency(islem.tutar)}
                      </td>
                      <td className="py-3.5 px-4 text-right whitespace-nowrap">
                        {profile?.rol !== 'muhasebeci' ? (
                          <div className="inline-flex items-center justify-end gap-1.5">
                            {onEditIslem && !islem.iptal && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onEditIslem(islem);
                                }}
                                className="px-2.5 py-1.5 rounded-lg bg-amber-500/15 hover:bg-amber-500/30 text-amber-300 border border-amber-500/30 text-[11px] font-bold inline-flex items-center gap-1 transition"
                                title="Makbuzu Güncelle"
                              >
                                <Pencil className="w-3 h-3" />
                                <span>Güncelle</span>
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setIslemToDelete(islem);
                              }}
                              data-testid={`delete_receipt_${islem.id}`}
                              className="px-2.5 py-1.5 rounded-lg bg-red-500/15 hover:bg-red-500/30 text-red-300 border border-red-500/30 text-[11px] font-bold inline-flex items-center gap-1 transition"
                              title="Makbuzu Sil"
                            >
                              <Trash2 className="w-3 h-3" />
                              <span>Sil</span>
                            </button>
                          </div>
                        ) : (
                          <span className="text-gray-600 text-[11px]">-</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* MOBİL KART GÖRÜNÜMÜ */}
            <div className="md:hidden divide-y divide-white/[0.04]">
              {filteredIslemler.map((islem) => (
                <div
                  key={islem.id}
                  onClick={() => onOpenMakbuz(islem)}
                  className="p-4 hover:bg-white/[0.03] transition cursor-pointer"
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="font-mono text-xs font-bold text-teal-400">
                      {islem.makbuz_no || `#${islem.id.slice(0, 8)}`}
                    </span>
                    <span
                      className={`text-sm font-bold ${
                        islem.iptal
                          ? 'line-through text-gray-500'
                          : islem.tip === 'tahsilat'
                          ? 'text-teal-400'
                          : 'text-orange-400'
                      }`}
                    >
                      {formatCurrency(islem.tutar)}
                    </span>
                  </div>

                  <div className="text-xs font-semibold text-white mb-1 truncate">
                    {islem.cariler?.unvan || 'Cari Belirtilmemiş'}
                  </div>

                  <div className="flex items-center justify-between text-[11px] text-gray-400 pt-1">
                    <div className="flex items-center gap-2">
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${
                          islem.tip === 'tahsilat'
                            ? 'bg-teal-500/10 text-teal-400'
                            : 'bg-orange-500/10 text-orange-400'
                        }`}
                      >
                        {islem.tip}
                      </span>
                      <span className="capitalize">{islem.tur.replace('_', ' ')}</span>
                      {isKarmaAciklama(islem.aciklama) && (
                        <span className="px-1.5 py-0.5 rounded bg-cyan-500/15 border border-cyan-500/30 text-cyan-300 text-[9px] font-bold uppercase">
                          Karma
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      <span>{formatDate(islem.tarih)}</span>
                      {islem.iptal && (
                        <span className="text-[10px] font-bold text-red-400">(İPTAL)</span>
                      )}
                      {profile?.rol !== 'muhasebeci' && (
                        <>
                          {onEditIslem && !islem.iptal && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                onEditIslem(islem);
                              }}
                              className="ml-1 px-2 py-1 rounded-lg bg-amber-500/15 hover:bg-amber-500/30 text-amber-300 border border-amber-500/30 text-[10px] font-bold inline-flex items-center gap-1 transition"
                            >
                              <Pencil className="w-3 h-3" />
                              <span>Güncelle</span>
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setIslemToDelete(islem);
                            }}
                            className="px-2 py-1 rounded-lg bg-red-500/15 hover:bg-red-500/30 text-red-300 border border-red-500/30 text-[10px] font-bold inline-flex items-center gap-1 transition"
                            title="Makbuzu Sil"
                          >
                            <Trash2 className="w-3 h-3" />
                            <span>Sil</span>
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* MAKBUZ SİLME ONAY MODALI */}
      <DeleteReceiptConfirmModal
        islem={islemToDelete}
        onClose={() => setIslemToDelete(null)}
        onDeleted={fetchIslemler}
      />
    </div>
  );
};
