"use client";
import { useState } from "react";
import { Menu, X, Wallet } from "lucide-react";
import { APP_URL, NAV } from "@/lib/data";

export default function Navbar() {
  const [open, setOpen] = useState(false);
  return (
    <header className="sticky top-0 z-50 border-b border-white/10 bg-obsidian/80 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5">
        <a href="#" className="flex items-center gap-2 font-extrabold tracking-tight">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-mint text-obsidian"><Wallet size={18} aria-hidden /></span>
          E-Tahsilat
        </a>
        <nav aria-label="Ana menü" className="hidden items-center gap-1 md:flex">
          {NAV.map((n) => (
            <a key={n.href} href={n.href} className="inline-flex min-h-12 items-center rounded-lg px-3 text-sm text-slate-300 transition hover:text-mint">{n.label}</a>
          ))}
        </nav>
        <div className="hidden items-center gap-2 md:flex">
          <a href={APP_URL} className="inline-flex min-h-12 items-center rounded-lg px-4 text-sm font-semibold text-slate-200 transition hover:bg-white/5">Giriş Yap</a>
          <a href={APP_URL} className="inline-flex min-h-12 items-center rounded-lg bg-mint px-5 text-sm font-bold text-obsidian shadow-[0_8px_28px_-6px_rgba(45,212,191,.6)] transition hover:brightness-110">Ücretsiz Dene</a>
        </div>
        <button className="grid h-12 w-12 place-items-center rounded-lg md:hidden" aria-label={open ? "Menüyü kapat" : "Menüyü aç"} aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? <X /> : <Menu />}
        </button>
      </div>
      {open && (
        <div className="border-t border-white/10 px-5 pb-5 md:hidden">
          {NAV.map((n) => (
            <a key={n.href} href={n.href} onClick={() => setOpen(false)} className="flex min-h-12 items-center border-b border-white/5 text-slate-200">{n.label}</a>
          ))}
          <div className="mt-4 grid gap-2">
            <a href={APP_URL} className="flex min-h-12 items-center justify-center rounded-lg border border-white/15 font-semibold">Giriş Yap</a>
            <a href={APP_URL} className="flex min-h-12 items-center justify-center rounded-lg bg-mint font-bold text-obsidian">Ücretsiz Dene</a>
          </div>
        </div>
      )}
    </header>
  );
}
