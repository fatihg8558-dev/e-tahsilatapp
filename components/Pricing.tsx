"use client";
import { useState } from "react";
import { Check } from "lucide-react";
import { APP_URL, CONTACT_EMAIL, PLANS } from "@/lib/data";

export default function Pricing() {
  const [yearly, setYearly] = useState(false);
  const fmt = (n: number) => n.toLocaleString("tr-TR");
  return (
    <section id="fiyat" className="mx-auto max-w-6xl px-5 py-20">
      <div className="text-center">
        <h2 className="text-3xl font-extrabold tracking-tight sm:text-4xl">Sade fiyatlandırma</h2>
        <p className="mt-3 text-slate-300">Tüm planlarda 7 gün ücretsiz deneme. Ödeme IBAN/havale ile yapılır; dekontu yüklersiniz, onaylanınca süreniz uzar.</p>
        <div className="mt-6 inline-flex items-center gap-3">
          <span className={yearly ? "text-slate-400" : "font-semibold"}>Aylık</span>
          <button role="switch" aria-checked={yearly} aria-label="Yıllık faturalama" onClick={() => setYearly(!yearly)} className="relative h-12 w-20 rounded-full border border-white/15 bg-white/5">
            <span className={`absolute top-1.5 h-9 w-9 rounded-full bg-mint transition-all ${yearly ? "left-[2.6rem]" : "left-1.5"}`} />
          </button>
          <span className={yearly ? "font-semibold" : "text-slate-400"}>Yıllık</span>
          <span className="rounded-full bg-ember/15 px-3 py-1 text-xs font-bold text-ember">%20 indirim</span>
        </div>
      </div>
      <div className="mt-10 grid gap-5 md:grid-cols-3">
        {PLANS.map((p) => (
          <article key={p.name} className={`relative flex flex-col rounded-2xl border p-7 ${p.popular ? "border-mint bg-mint/[0.06] shadow-[0_0_60px_-15px_rgba(45,212,191,.5)]" : "border-white/10 bg-white/[0.03]"}`}>
            {p.popular && <span className="absolute -top-3 left-7 rounded-full bg-ember px-3 py-1 text-xs font-extrabold text-obsidian">En popüler</span>}
            <h3 className="text-xl font-bold">{p.name}</h3>
            <p className="mt-1 text-sm text-slate-300">{p.desc}</p>
            <p className="mt-5">
              {p.monthly === null ? <span className="text-3xl font-extrabold">Teklif alın</span> : (<><span className="text-4xl font-extrabold tracking-tight">₺{fmt(yearly ? Math.round(p.monthly * 0.8) : p.monthly)}</span><span className="text-slate-400"> / ay</span></>)}
            </p>
            {p.monthly !== null && yearly && <p className="mt-1 text-xs text-slate-400">Yıllık ₺{fmt(Math.round(p.monthly * 0.8 * 12))} olarak faturalanır</p>}
            <ul className="mt-6 flex-1 space-y-3 text-sm">
              {p.features.map((f) => (<li key={f} className="flex gap-2"><Check size={18} className="mt-0.5 shrink-0 text-mint" aria-hidden />{f}</li>))}
            </ul>
            <a href={p.monthly === null ? `mailto:${CONTACT_EMAIL}` : APP_URL} className={`mt-7 flex min-h-12 items-center justify-center rounded-xl font-bold transition ${p.popular ? "bg-mint text-obsidian hover:brightness-110" : "border border-white/15 hover:border-mint/50 hover:text-mint"}`}>{p.cta}</a>
          </article>
        ))}
      </div>
    </section>
  );
}
