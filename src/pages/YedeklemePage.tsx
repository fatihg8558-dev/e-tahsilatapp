import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import {
  AppBackupPayload,
  RestorePoint,
  createAppBackupPayload,
  deleteRestorePoint,
  downloadJsonBackup,
  getLastBackupAt,
  getNextFridayLabel,
  getRestorePoints,
  parseBackupJson,
  restoreFromBackupPayload,
  saveRestorePoint,
} from '../lib/backupService';
import { formatDate } from '../lib/formatters';
import {
  Download,
  Upload,
  History,
  RotateCcw,
  Trash2,
  CheckCircle2,
  AlertCircle,
  CalendarClock,
  FileJson,
  ShieldCheck,
  BellRing,
  RefreshCw,
  HardDriveDownload,
} from 'lucide-react';

interface YedeklemePageProps {
  onBackupChanged?: () => void;
  onRestored?: () => void;
}

export const YedeklemePage: React.FC<YedeklemePageProps> = ({
  onBackupChanged,
  onRestored,
}) => {
  const { firma, profile, user } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [restorePoints, setRestorePoints] = useState<RestorePoint[]>([]);
  const [lastBackupAt, setLastBackupAt] = useState<string | null>(null);
  const [pointLabel, setPointLabel] = useState('');

  const [exporting, setExporting] = useState(false);
  const [creatingPoint, setCreatingPoint] = useState(false);
  const [restoring, setRestoring] = useState(false);

  const [pendingRestorePayload, setPendingRestorePayload] = useState<{
    sourceLabel: string;
    payload: AppBackupPayload;
  } | null>(null);

  const [feedback, setFeedback] = useState<{
    type: 'success' | 'error' | 'warning';
    text: string;
  } | null>(null);

  const [webNotifPermission, setWebNotifPermission] = useState<NotificationPermission | 'unsupported'>(() => {
    if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
    return Notification.permission;
  });

  useEffect(() => {
    if (firma?.id) {
      setRestorePoints(getRestorePoints(firma.id));
    }
    setLastBackupAt(getLastBackupAt(firma?.id, profile?.id || user?.id));
  }, [firma?.id, profile?.id, user?.id]);

  const effectiveFirma = firma || (profile?.firma_id
    ? { id: profile.firma_id, unvan: 'Firma Hesabı', vergi_no: '' }
    : null);

  const handleDownloadJsonBackup = async () => {
    if (!effectiveFirma) return;
    try {
      setExporting(true);
      setFeedback(null);
      const payload = await createAppBackupPayload(effectiveFirma, profile, user);
      const fileName = downloadJsonBackup(payload);

      // Aynı zamanda otomatik bir geri yükleme noktası da kaydet (kota elverirse)
      try {
        saveRestorePoint(
          effectiveFirma.id,
          `JSON Yedek (${new Date().toLocaleDateString('tr-TR')})`,
          payload
        );
        setRestorePoints(getRestorePoints(effectiveFirma.id));
      } catch {
        // ignore quota error during optional snapshot
      }

      setLastBackupAt(getLastBackupAt(effectiveFirma.id, profile?.id || user?.id));
      onBackupChanged?.();
      setFeedback({
        type: 'success',
        text: `JSON yedek dosyası oluşturuldu (${fileName}) — ${payload.data.cariler.length} cari, ${payload.data.islemler.length} işlem, ${payload.data.kasalar.length} kasa, ${payload.data.gelir_giderler.length} gelir/gider kaydı yedeklendi.`,
      });
    } catch (err: any) {
      setFeedback({
        type: 'error',
        text: err?.message || 'JSON yedeği alınırken bir hata oluştu.',
      });
    } finally {
      setExporting(false);
    }
  };

  const handleCreateRestorePoint = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!effectiveFirma) return;
    try {
      setCreatingPoint(true);
      setFeedback(null);
      const payload = await createAppBackupPayload(effectiveFirma, profile, user);
      const saved = saveRestorePoint(effectiveFirma.id, pointLabel, payload);
      setRestorePoints(getRestorePoints(effectiveFirma.id));
      setLastBackupAt(getLastBackupAt(effectiveFirma.id, profile?.id || user?.id));
      setPointLabel('');
      onBackupChanged?.();
      setFeedback({
        type: 'success',
        text: `"${saved.label}" geri yükleme noktası kaydedildi (${saved.counts.cariler} cari, ${saved.counts.islemler} işlem).`,
      });
    } catch (err: any) {
      setFeedback({
        type: 'error',
        text: err?.message || 'Geri yükleme noktası oluşturulamadı.',
      });
    } finally {
      setCreatingPoint(false);
    }
  };

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    try {
      setFeedback(null);
      const text = await file.text();
      const payload = parseBackupJson(text);
      setPendingRestorePayload({
        sourceLabel: file.name,
        payload,
      });
    } catch (err: any) {
      setFeedback({
        type: 'error',
        text: err?.message || 'JSON dosyası okunamadı.',
      });
    }
  };

  const handleConfirmRestore = async () => {
    if (!pendingRestorePayload || !effectiveFirma) return;
    try {
      setRestoring(true);
      setFeedback(null);
      const res = await restoreFromBackupPayload(
        pendingRestorePayload.payload,
        effectiveFirma,
        profile,
        user
      );

      setRestorePoints(getRestorePoints(effectiveFirma.id));

      if (!res.success) {
        setFeedback({
          type: 'error',
          text: res.error || 'Geri yükleme başarısız oldu.',
        });
        return;
      }

      setPendingRestorePayload(null);
      onRestored?.();

      const summary = `${res.restored.cariler} cari, ${res.restored.islemler} işlem, ${res.restored.faturalar} fatura, ${res.restored.kasalar} kasa ve ${res.restored.gelir_giderler} gelir/gider geri yüklendi.`;
      setFeedback({
        type: res.warnings.length > 0 ? 'warning' : 'success',
        text:
          res.warnings.length > 0
            ? `Geri yükleme tamamlandı (${summary}). Notlar: ${res.warnings.join(' • ')}`
            : `Geri yükleme başarıyla tamamlandı! ${summary}`,
      });
    } finally {
      setRestoring(false);
    }
  };

  const handleDeletePoint = (pointId: string) => {
    if (!effectiveFirma) return;
    if (!window.confirm('Bu geri yükleme noktasını silmek istediğinize emin misiniz?')) return;
    setRestorePoints(deleteRestorePoint(effectiveFirma.id, pointId));
  };

  const handleRequestWebNotifications = async () => {
    if (typeof window === 'undefined' || !('Notification' in window)) return;
    try {
      const perm = await Notification.requestPermission();
      setWebNotifPermission(perm);
      if (perm === 'granted') {
        new Notification('Tahsilatım Yedekleme Hatırlatıcısı', {
          body: 'Her Cuma haftalık JSON yedekleme hatırlatıcısı aktif edildi.',
        });
      }
    } catch {
      // ignore
    }
  };

  const isFridayToday = new Date().getDay() === 5;

  return (
    <div className="space-y-6 pb-8">
      {/* BAŞLIK & CUMA HATIRLATICISI KARTI */}
      <div className="bg-gradient-to-r from-[#111c2e] via-[#13233a] to-[#111c2e] border border-teal-500/30 rounded-2xl p-5 sm:p-6 shadow-xl">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex items-start gap-3.5">
            <div className="w-12 h-12 rounded-2xl bg-teal-400/15 border border-teal-400/35 text-teal-400 flex items-center justify-center shrink-0">
              <FileJson className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-lg sm:text-xl font-black text-white tracking-tight">
                Veri Yedekleme &amp; Geri Yükleme Noktası
              </h1>
              <p className="text-xs text-slate-300 mt-1 max-w-2xl leading-relaxed">
                Tüm uygulama verilerinizi (cariler, tahsilat/tediye makbuzları, faturalar, kasalar ve gelir/gider hareketleri) standart <strong className="text-teal-300">.json</strong> formatında cihazınıza yedekleyebilir, geri yükleme noktası oluşturabilir ve tek tıkla geri dönebilirsiniz.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={handleDownloadJsonBackup}
            disabled={exporting || !effectiveFirma}
            data-testid="download_json_backup_btn"
            className="min-h-[48px] px-5 py-3 rounded-xl bg-teal-400 hover:bg-teal-300 disabled:opacity-50 text-slate-950 font-extrabold text-xs sm:text-sm flex items-center justify-center gap-2 shadow-[0_0_25px_rgba(45,212,191,0.3)] transition shrink-0"
          >
            {exporting ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                <span>Yedek Hazırlanıyor...</span>
              </>
            ) : (
              <>
                <Download className="w-4 h-4" />
                <span>Tam JSON Yedek İndir</span>
              </>
            )}
          </button>
        </div>

        {/* HAFTALIK CUMA HATIRLATICI DURUMU */}
        <div className="mt-5 pt-4 border-t border-white/[0.08] grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
          <div className="p-3 rounded-xl bg-black/25 border border-white/[0.06] flex items-center gap-3">
            <CalendarClock className={`w-5 h-5 shrink-0 ${isFridayToday ? 'text-amber-400' : 'text-teal-400'}`} />
            <div>
              <div className="text-[10px] uppercase tracking-wider text-slate-400 font-bold">
                Haftalık Hatırlatıcı (Her Cuma)
              </div>
              <div className="text-white font-bold mt-0.5">
                {getNextFridayLabel()}
              </div>
            </div>
          </div>

          <div className="p-3 rounded-xl bg-black/25 border border-white/[0.06] flex items-center gap-3">
            <ShieldCheck className="w-5 h-5 shrink-0 text-emerald-400" />
            <div>
              <div className="text-[10px] uppercase tracking-wider text-slate-400 font-bold">
                Son Yedekleme Zamanı
              </div>
              <div className="text-white font-bold mt-0.5">
                {lastBackupAt
                  ? new Date(lastBackupAt).toLocaleString('tr-TR', {
                      day: '2-digit',
                      month: '2-digit',
                      year: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })
                  : 'Henüz yedek alınmadı'}
              </div>
            </div>
          </div>

          <div className="p-3 rounded-xl bg-black/25 border border-white/[0.06] flex items-center justify-between gap-2">
            <div className="flex items-center gap-2.5 min-w-0">
              <BellRing className="w-5 h-5 shrink-0 text-sky-400" />
              <div className="min-w-0">
                <div className="text-[10px] uppercase tracking-wider text-slate-400 font-bold">
                  Bildirim Durumu
                </div>
                <div className="text-white font-bold truncate mt-0.5">
                  {webNotifPermission === 'granted'
                    ? 'Aktif (Uygulama + Bildirim)'
                    : 'Uygulama İçi Aktif'}
                </div>
              </div>
            </div>
            {webNotifPermission === 'default' && (
              <button
                type="button"
                onClick={handleRequestWebNotifications}
                className="px-2.5 py-1.5 rounded-lg bg-sky-500/20 hover:bg-sky-500/30 text-sky-300 border border-sky-500/30 text-[11px] font-bold shrink-0 transition"
              >
                İzin Ver
              </button>
            )}
          </div>
        </div>
      </div>

      {/* BİLDİRİM MESAJI */}
      {feedback && (
        <div
          className={`p-4 rounded-2xl text-xs sm:text-sm flex items-start gap-2.5 border ${
            feedback.type === 'success'
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
              : feedback.type === 'warning'
              ? 'bg-amber-500/10 border-amber-500/30 text-amber-200'
              : 'bg-red-500/10 border-red-500/30 text-red-300'
          }`}
        >
          {feedback.type === 'success' ? (
            <CheckCircle2 className="w-5 h-5 shrink-0 mt-0.5" />
          ) : (
            <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
          )}
          <span className="leading-relaxed">{feedback.text}</span>
        </div>
      )}

      {/* ONAY BEKLEYEN GERİ YÜKLEME ÖNİZLEMESİ */}
      {pendingRestorePayload && (
        <div className="p-5 rounded-2xl bg-amber-500/10 border border-amber-400/40 space-y-4 shadow-xl">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <RotateCcw className="w-6 h-6 text-amber-300 shrink-0 mt-0.5" />
              <div>
                <h3 className="text-sm sm:text-base font-extrabold text-white">
                  Geri Yükleme Önizlemesi ve Onay
                </h3>
                <p className="text-xs text-amber-200/90 mt-0.5">
                  Kaynak: <strong>{pendingRestorePayload.sourceLabel}</strong> • Yedek Tarihi:{' '}
                  <strong>
                    {new Date(pendingRestorePayload.payload.exported_at).toLocaleString('tr-TR')}
                  </strong>
                </p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5 text-xs">
            <div className="p-2.5 rounded-xl bg-black/30 border border-white/10">
              <span className="text-slate-400 block text-[10px]">Cariler</span>
              <strong className="text-white text-sm font-mono">
                {pendingRestorePayload.payload.data.cariler.length}
              </strong>
            </div>
            <div className="p-2.5 rounded-xl bg-black/30 border border-white/10">
              <span className="text-slate-400 block text-[10px]">Makbuzlar</span>
              <strong className="text-white text-sm font-mono">
                {pendingRestorePayload.payload.data.islemler.length}
              </strong>
            </div>
            <div className="p-2.5 rounded-xl bg-black/30 border border-white/10">
              <span className="text-slate-400 block text-[10px]">Faturalar</span>
              <strong className="text-white text-sm font-mono">
                {pendingRestorePayload.payload.data.faturalar.length}
              </strong>
            </div>
            <div className="p-2.5 rounded-xl bg-black/30 border border-white/10">
              <span className="text-slate-400 block text-[10px]">Kasalar</span>
              <strong className="text-white text-sm font-mono">
                {pendingRestorePayload.payload.data.kasalar.length}
              </strong>
            </div>
            <div className="p-2.5 rounded-xl bg-black/30 border border-white/10">
              <span className="text-slate-400 block text-[10px]">Gelir / Gider</span>
              <strong className="text-white text-sm font-mono">
                {pendingRestorePayload.payload.data.gelir_giderler.length}
              </strong>
            </div>
          </div>

          <p className="text-[11px] text-slate-300 leading-relaxed">
            Güvenliğiniz için geri yükleme başlamadan hemen önce mevcut verilerinizden{' '}
            <strong className="text-teal-300">otomatik bir geri yükleme noktası</strong> oluşturulacaktır. Mevcut aynı ID&apos;li kayıtlar yedekteki verilerle güncellenir.
          </p>

          <div className="flex flex-wrap items-center justify-end gap-2.5">
            <button
              type="button"
              disabled={restoring}
              onClick={() => setPendingRestorePayload(null)}
              className="min-h-[44px] px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-slate-200 text-xs font-bold transition"
            >
              Vazgeç
            </button>
            <button
              type="button"
              disabled={restoring}
              onClick={handleConfirmRestore}
              data-testid="confirm_restore_btn"
              className="min-h-[44px] px-5 py-2 rounded-xl bg-amber-400 hover:bg-amber-300 disabled:opacity-50 text-slate-950 text-xs font-extrabold flex items-center gap-2 transition"
            >
              {restoring ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Geri Yükleniyor...</span>
                </>
              ) : (
                <>
                  <RotateCcw className="w-4 h-4" />
                  <span>Onayla ve Geri Yükle</span>
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* İKİ SÜTUN: GERİ YÜKLEME NOKTASI OLUŞTURMA & JSON DOSYADAN YÜKLEME */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* SOL: GERİ YÜKLEME NOKTASI OLUŞTUR */}
        <div className="bg-[#111c2e] border border-slate-700/60 rounded-2xl p-5 space-y-4">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 flex items-center justify-center">
              <History className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-extrabold text-white">Geri Yükleme Noktası Oluştur</h2>
              <p className="text-[11px] text-slate-400">
                Uygulama içinde anlık geri dönüş noktası (snapshot) saklayın.
              </p>
            </div>
          </div>

          <form onSubmit={handleCreateRestorePoint} className="space-y-3">
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                Nokta Adı / Açıklaması (Opsiyonel)
              </label>
              <input
                type="text"
                value={pointLabel}
                onChange={(e) => setPointLabel(e.target.value)}
                data-testid="restore_point_label_input"
                placeholder="Örn: Cuma Haftalık Kapanış veya Toplu İşlem Öncesi"
                className="w-full min-h-[44px] bg-[#0b1322] border border-slate-700/80 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-teal-400"
              />
            </div>

            <button
              type="submit"
              disabled={creatingPoint || !effectiveFirma}
              data-testid="create_restore_point_btn"
              className="w-full min-h-[44px] px-4 py-2.5 rounded-xl bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40 font-bold text-xs flex items-center justify-center gap-2 transition disabled:opacity-50"
            >
              {creatingPoint ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Oluşturuluyor...</span>
                </>
              ) : (
                <>
                  <History className="w-4 h-4" />
                  <span>Şimdi Geri Yükleme Noktası Oluştur</span>
                </>
              )}
            </button>
          </form>
        </div>

        {/* SAĞ: JSON DOSYASINDAN GERİ YÜKLEME */}
        <div className="bg-[#111c2e] border border-slate-700/60 rounded-2xl p-5 space-y-4">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-sky-500/15 border border-sky-500/30 text-sky-400 flex items-center justify-center">
              <Upload className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-extrabold text-white">JSON Dosyasından Geri Yükle</h2>
              <p className="text-[11px] text-slate-400">
                Daha önce indirdiğiniz .json yedek dosyasını seçip geri yükleyin.
              </p>
            </div>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            onChange={handleFileSelected}
            data-testid="upload_json_backup_input"
            className="hidden"
          />

          <div className="p-4 rounded-xl bg-[#0b1322] border border-dashed border-slate-600/80 text-center space-y-3">
            <HardDriveDownload className="w-7 h-7 text-sky-400 mx-auto" />
            <p className="text-[11px] text-slate-400 leading-relaxed">
              Bilgisayarınızdan veya telefonunuzdan <strong className="text-slate-200">.json</strong> uzantılı Tahsilatım yedek dosyasını seçin; geri yüklemeden önce kayıt sayıları size önizleme olarak gösterilir.
            </p>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              data-testid="select_json_backup_btn"
              className="min-h-[44px] px-5 py-2.5 rounded-xl bg-sky-500/20 hover:bg-sky-500/30 text-sky-300 border border-sky-500/40 font-bold text-xs inline-flex items-center gap-2 transition"
            >
              <Upload className="w-4 h-4" />
              <span>JSON Yedek Dosyası Seç</span>
            </button>
          </div>
        </div>
      </div>

      {/* KAYITLI GERİ YÜKLEME NOKTALARI LİSTESİ */}
      <div className="bg-[#111c2e] border border-slate-700/60 rounded-2xl p-5 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-extrabold text-white">
              Kayıtlı Geri Yükleme Noktaları ({restorePoints.length})
            </h2>
            <p className="text-[11px] text-slate-400">
              Cihaz hafızasında saklanan son geri yükleme noktalarından birine dönebilir veya JSON olarak indirebilirsiniz.
            </p>
          </div>
        </div>

        {restorePoints.length === 0 ? (
          <div className="p-8 text-center rounded-xl bg-[#0b1322] border border-white/[0.06] text-xs text-slate-400 space-y-2">
            <History className="w-7 h-7 text-slate-600 mx-auto" />
            <p className="font-semibold text-slate-300">Henüz geri yükleme noktası oluşturulmadı.</p>
            <p className="text-[11px] text-slate-500">
              Yukarıdan &quot;Şimdi Geri Yükleme Noktası Oluştur&quot; veya &quot;Tam JSON Yedek İndir&quot; butonunu kullanabilirsiniz.
            </p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {restorePoints.map((rp) => (
              <div
                key={rp.id}
                className="p-4 rounded-xl bg-[#0b1322] border border-white/[0.06] flex flex-col md:flex-row md:items-center justify-between gap-3"
              >
                <div className="space-y-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-bold text-white text-xs sm:text-sm">{rp.label}</span>
                    <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-teal-500/15 text-teal-300 border border-teal-500/30">
                      {formatDate(rp.created_at)} •{' '}
                      {new Date(rp.created_at).toLocaleTimeString('tr-TR', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-400 flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span>Oluşturan: {rp.created_by}</span>
                    <span>•</span>
                    <span>{rp.counts.cariler} Cari</span>
                    <span>•</span>
                    <span>{rp.counts.islemler} Makbuz</span>
                    {rp.counts.kasalar > 0 && (
                      <>
                        <span>•</span>
                        <span>{rp.counts.kasalar} Kasa</span>
                      </>
                    )}
                    {rp.counts.gelir_giderler > 0 && (
                      <>
                        <span>•</span>
                        <span>{rp.counts.gelir_giderler} Gelir/Gider</span>
                      </>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2 flex-wrap shrink-0">
                  <button
                    type="button"
                    onClick={() => downloadJsonBackup(rp.payload)}
                    className="min-h-[40px] px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-200 border border-white/10 text-[11px] font-bold flex items-center gap-1.5 transition"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>JSON İndir</span>
                  </button>

                  <button
                    type="button"
                    data-testid={`restore_point_btn_${rp.id}`}
                    onClick={() =>
                      setPendingRestorePayload({
                        sourceLabel: rp.label,
                        payload: rp.payload,
                      })
                    }
                    className="min-h-[40px] px-3 py-1.5 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/30 text-[11px] font-bold flex items-center gap-1.5 transition"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Bu Noktaya Dön</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleDeletePoint(rp.id)}
                    aria-label="Geri yükleme noktasını sil"
                    className="min-h-[40px] px-2.5 py-1.5 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/25 text-[11px] font-bold flex items-center justify-center transition"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
