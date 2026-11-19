import React, { useEffect, useState } from 'react';
import { X, MessageCircle, Copy, Check, RotateCcw, Phone } from 'lucide-react';
import { openWhatsApp } from '../../lib/linkHelper';

interface WhatsAppReminderModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  initialPhone?: string | null;
  defaultMessage: string;
  badgeText?: string;
}

export const WhatsAppReminderModal: React.FC<WhatsAppReminderModalProps> = ({
  isOpen,
  onClose,
  title,
  subtitle,
  initialPhone,
  defaultMessage,
  badgeText,
}) => {
  const [phone, setPhone] = useState(initialPhone || '');
  const [message, setMessage] = useState(defaultMessage);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setPhone(initialPhone || '');
      setMessage(defaultMessage);
      setCopied(false);
    }
  }, [isOpen, initialPhone, defaultMessage]);

  if (!isOpen) return null;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(message);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore clipboard errors
    }
  };

  const handleOpenWhatsApp = () => {
    openWhatsApp(phone.trim() || null, message);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
      data-testid="whatsapp_reminder_modal"
    >
      <div className="bg-[#111820] border border-emerald-500/25 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Başlık */}
        <div className="p-4 sm:p-5 border-b border-white/[0.07] bg-gradient-to-r from-emerald-500/15 via-teal-500/5 to-transparent flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/20 border border-emerald-500/35 text-emerald-400 flex items-center justify-center shrink-0">
              <MessageCircle className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-sm sm:text-base font-extrabold text-white truncate">
                  {title}
                </h3>
                {badgeText && (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                    {badgeText}
                  </span>
                )}
              </div>
              {subtitle && (
                <p className="text-[11px] text-slate-400 mt-0.5 truncate">{subtitle}</p>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="WhatsApp hatırlatma penceresini kapat"
            className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-white/5 transition shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* İçerik */}
        <div className="p-4 sm:p-5 space-y-4 text-xs">
          <div>
            <label
              htmlFor="wa-reminder-phone"
              className="block text-[11px] font-bold uppercase tracking-wider text-slate-300 mb-1.5"
            >
              Alıcı Telefon Numarası (Opsiyonel)
            </label>
            <div className="relative">
              <Phone className="w-4 h-4 text-emerald-400 absolute left-3 top-3" />
              <input
                id="wa-reminder-phone"
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                data-testid="whatsapp_reminder_phone_input"
                placeholder="Örn: 05XX XXX XX XX (Boşsa WhatsApp kişi seçimi açılır)"
                className="w-full min-h-[42px] bg-[#0a0e13] border border-white/15 rounded-xl pl-9 pr-3.5 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-400 font-mono"
              />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label
                htmlFor="wa-reminder-message"
                className="text-[11px] font-bold uppercase tracking-wider text-slate-300"
              >
                Gönderilecek Hatırlatma Mesajı
              </label>
              <button
                type="button"
                onClick={() => setMessage(defaultMessage)}
                className="text-[11px] font-semibold text-teal-400 hover:text-teal-300 inline-flex items-center gap-1"
              >
                <RotateCcw className="w-3 h-3" />
                <span>Şablonu Sıfırla</span>
              </button>
            </div>
            <textarea
              id="wa-reminder-message"
              rows={7}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              data-testid="whatsapp_reminder_message_input"
              className="w-full bg-[#0a0e13] border border-white/15 rounded-xl p-3 text-xs text-slate-100 leading-relaxed focus:outline-none focus:border-emerald-400"
            />
          </div>
        </div>

        {/* Aksiyonlar */}
        <div className="p-4 sm:p-5 border-t border-white/[0.07] bg-black/25 flex flex-wrap items-center justify-between gap-2.5">
          <button
            type="button"
            onClick={handleCopy}
            data-testid="whatsapp_reminder_copy_btn"
            className="min-h-[44px] px-3.5 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-slate-200 border border-white/10 text-xs font-bold inline-flex items-center gap-1.5 transition"
          >
            {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
            <span>{copied ? 'Kopyalandı' : 'Mesajı Kopyala'}</span>
          </button>

          <div className="flex items-center gap-2 ml-auto">
            <button
              type="button"
              onClick={onClose}
              className="min-h-[44px] px-4 py-2 rounded-xl border border-white/10 text-slate-300 hover:bg-white/5 text-xs font-semibold transition"
            >
              Vazgeç
            </button>
            <button
              type="button"
              onClick={handleOpenWhatsApp}
              disabled={!message.trim()}
              data-testid="whatsapp_reminder_send_btn"
              className="min-h-[44px] px-5 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-slate-950 text-xs font-extrabold inline-flex items-center gap-2 shadow-[0_0_20px_rgba(16,185,129,0.25)] transition"
            >
              <MessageCircle className="w-4 h-4" />
              <span>WhatsApp&apos;ta Aç</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
