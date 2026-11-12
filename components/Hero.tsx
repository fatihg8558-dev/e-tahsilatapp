import { ArrowRight, PlayCircle, Check } from "lucide-react";
import { APP_URL } from "@/lib/data";

const ROWS = [
  { n: "Yılmaz Gıda", t: "Nakit", a: "12.500,00" },
  { n: "Demir Nakliyat", t: "Çek", a: "48.000,00" },
  { n: "Kaya Market", t: "Kredi kartı", a: "3.250,00" },
  { n: "Öz Hırdavat", t: "Senet", a: "21.700,00" },
];

export default function Hero() {
  return (
    <section className="relative overflow-hidden">
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[560px] bg-[radial-gradient(60%_60%_at_50%_0%,rgba(45,212,191,.18),transparent)]" />
      <div className="relative mx-auto max-w-6xl px-5 pb-20 pt-16 text-center md:pt-24">
        <span className="inline-flex items-center gap-2 rounded-full border border-ember/40 bg-ember/10 px-4 py-1.5 text-sm font-semibold text-ember">7 gün ücretsiz deneme</span>
        <h1 className="mx-auto mt-6 max-w-3xl text-4xl font-extrabold leading-[1.05] tracking-tight sm:text-6xl">
          Tahsilat ve tediyeyi <span className="text-mint">sahadan ofise</span> tek panelde yönetin
        </h1>
        <p className="mx-auto mt-5 max-w-2xl text-lg text-slate-300">
          Makbuzu kesin, WhatsApp veya e-postayla gönderin. Plasiyerlerinizin tahsilatları gün sonunda ana hesabınıza geçsin; cari, çek ve senet kayıtları düzenli kalsın.
        </p>
        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <a href={APP_URL} className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-mint px-7 font-bold text-obsidian shadow-[0_10px_40px_-8px_rgba(45,212,191,.7)] transition hover:brightness-110">
            Ücretsiz Başla <ArrowRight size={18} aria-hidden />
          </a>
          <a href="#nasil" className="inline-flex min-h-12 items-center gap-2 rounded-xl border border-white/15 px-7 font-semibold transition hover:border-mint/50 hover:text-mint">
            <PlayCircle size={18} aria-hidden /> Demosunu İncele
          </a>
        </div>
        <ul className="mt-6 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-slate-400">
          {["Kredi kartı gerekmez", "7 gün ücretsiz deneme", "2 dakikada kurulum"].map((t) => (
            <li key={t} className="flex items-center gap-1.5"><Check size={16} className="text-mint" aria-hidden />{t}</li>
          ))}
        </ul>

        <div aria-hidden className="mx-auto mt-14 max-w-3xl rounded-2xl border border-white/10 bg-white/[0.04] p-2 text-left shadow-[0_30px_80px_-20px_rgba(45,212,191,.25)] backdrop-blur">
          <div className="rounded-xl bg-[#0d131a] p-5">
            <div className="mb-4 flex gap-1.5"><i className="h-2.5 w-2.5 rounded-full bg-red-400/70" /><i className="h-2.5 w-2.5 rounded-full bg-ember/70" /><i className="h-2.5 w-2.5 rounded-full bg-mint/70" /></div>
            <div className="flex items-end justify-between">
              <div><p className="text-xs text-slate-400">Bugünkü tahsilat (örnek ekran)</p><p className="text-3xl font-extrabold tracking-tight">₺85.450,00</p></div>
              <div className="flex h-14 items-end gap-1.5">
                {[30, 45, 38, 60, 52, 75, 100].map((h, i) => (<span key={i} style={{ height: `${h}%` }} className={`w-3 rounded-sm ${i === 6 ? "bg-ember" : "bg-mint/60"}`} />))}
              </div>
            </div>
            <ul className="mt-5 divide-y divide-white/5">
              {ROWS.map((r) => (
                <li key={r.n} className="flex items-center justify-between py-2.5 text-sm">
                  <span>{r.n}</span>
                  <span className="flex items-center gap-3"><span className="rounded-full bg-mint/15 px-2.5 py-0.5 text-xs text-mint">{r.t}</span><span className="w-24 text-right font-semibold tabular-nums">₺{r.a}</span></span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
