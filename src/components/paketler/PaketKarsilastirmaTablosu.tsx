import React from 'react';
import { BarChart3, Check, X } from 'lucide-react';
import {
  COMPARISON_FEATURE_ROWS,
  PACKAGE_TIERS,
  PackageTierKey,
  formatTlInteger,
} from '../../lib/packageCatalog';

interface PaketKarsilastirmaTablosuProps {
  selectedTierKey?: PackageTierKey | null;
  onSelectTier?: (tierKey: PackageTierKey) => void;
  compact?: boolean;
}

export const PaketKarsilastirmaTablosu: React.FC<PaketKarsilastirmaTablosuProps> = ({
  selectedTierKey,
  onSelectTier,
  compact = false,
}) => {

  return (
    <section
      data-testid="paket_karsilastirma_tablosu"
      className="bg-[#111820] border border-white/[0.08] rounded-2xl overflow-hidden shadow-xl"
    >
      {/* BAŞLIK */}
      <div className="px-4 sm:px-6 py-4 border-b border-white/[0.08] bg-black/20 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-teal-400/15 border border-teal-400/30 text-teal-300 flex items-center justify-center shrink-0">
            <BarChart3 className="w-4 h-4" />
          </div>
          <h3 className="text-sm sm:text-base font-extrabold text-white tracking-tight">
            Paket Karşılaştırma Tablosu
          </h3>
        </div>
        <span className="text-[11px] text-gray-400">
          6 Aylıkta <strong className="text-teal-300">1 Ay</strong>, Yıllıkta{' '}
          <strong className="text-teal-300">3 Ay Hediye</strong>
        </span>
      </div>

      {/* TABLO */}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[600px] text-left border-collapse">
          <thead>
            <tr className="border-b border-white/[0.08] bg-black/15">
              <th
                scope="col"
                className={`${
                  compact ? 'py-3 px-4' : 'py-3.5 px-5'
                } text-xs sm:text-[13px] font-bold text-gray-200 sticky left-0 bg-[#101720] z-10`}
              >
                Özellikler &amp; Fiyatlar
              </th>
              {PACKAGE_TIERS.map((tier) => {
                const isSelected = selectedTierKey === tier.key;
                return (
                  <th
                    key={tier.key}
                    scope="col"
                    className={`${
                      compact ? 'py-3 px-3.5' : 'py-3.5 px-4'
                    } text-xs sm:text-[13px] font-extrabold text-center whitespace-nowrap ${
                      isSelected ? 'text-teal-300 bg-teal-400/[0.06]' : 'text-white'
                    }`}
                  >
                    {onSelectTier ? (
                      <button
                        type="button"
                        onClick={() => onSelectTier(tier.key)}
                        className="inline-flex items-center gap-1.5 hover:text-teal-300 transition"
                      >
                        <span>{tier.title}</span>
                      </button>
                    ) : (
                      <span>{tier.title}</span>
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>

          <tbody className="divide-y divide-white/[0.06] text-xs sm:text-[13px]">
            {/* Aylık Fiyat */}
            <tr className="hover:bg-white/[0.02] transition-colors">
              <td className="py-3 px-4 sm:px-5 font-semibold text-gray-200 sticky left-0 bg-[#111820] z-10">
                Aylık Fiyat
              </td>
              {PACKAGE_TIERS.map((tier) => (
                <td
                  key={tier.key}
                  className={`py-3 px-4 text-center font-bold text-white whitespace-nowrap ${
                    selectedTierKey === tier.key ? 'bg-teal-400/[0.04]' : ''
                  }`}
                >
                  {formatTlInteger(tier.prices.aylik)}
                </td>
              ))}
            </tr>

            {/* 6 Aylık Fiyat (1 Ay Hediye) */}
            <tr className="hover:bg-white/[0.02] transition-colors">
              <td className="py-3 px-4 sm:px-5 font-semibold text-gray-200 sticky left-0 bg-[#111820] z-10">
                6 Aylık Fiyat{' '}
                <span className="italic font-normal text-teal-300/90">(1 Ay Hediye)</span>
              </td>
              {PACKAGE_TIERS.map((tier) => (
                <td
                  key={tier.key}
                  className={`py-3 px-4 text-center font-bold text-white whitespace-nowrap ${
                    selectedTierKey === tier.key ? 'bg-teal-400/[0.04]' : ''
                  }`}
                >
                  {formatTlInteger(tier.prices.alti_aylik)}
                </td>
              ))}
            </tr>

            {/* Yıllık Fiyat (3 Ay Hediye) */}
            <tr className="hover:bg-white/[0.02] transition-colors">
              <td className="py-3 px-4 sm:px-5 font-semibold text-gray-200 sticky left-0 bg-[#111820] z-10">
                Yıllık Fiyat{' '}
                <span className="italic font-normal text-teal-300/90">(3 Ay Hediye)</span>
              </td>
              {PACKAGE_TIERS.map((tier) => (
                <td
                  key={tier.key}
                  className={`py-3 px-4 text-center font-bold text-white whitespace-nowrap ${
                    selectedTierKey === tier.key ? 'bg-teal-400/[0.04]' : ''
                  }`}
                >
                  {formatTlInteger(tier.prices.yillik)}
                </td>
              ))}
            </tr>

            {/* Dahil Kullanıcı Sayısı */}
            <tr className="hover:bg-white/[0.02] transition-colors">
              <td className="py-3 px-4 sm:px-5 font-semibold text-gray-200 sticky left-0 bg-[#111820] z-10">
                Dahil Kullanıcı Sayısı
              </td>
              {PACKAGE_TIERS.map((tier) => (
                <td
                  key={tier.key}
                  className={`py-3 px-4 text-center text-gray-200 font-medium whitespace-nowrap ${
                    selectedTierKey === tier.key ? 'bg-teal-400/[0.04]' : ''
                  }`}
                >
                  {tier.includedUsers}
                </td>
              ))}
            </tr>

            {/* Ek Plasiyer Ücreti */}
            <tr className="hover:bg-white/[0.02] transition-colors">
              <td className="py-3 px-4 sm:px-5 font-semibold text-gray-200 sticky left-0 bg-[#111820] z-10">
                Ek Plasiyer Ücreti
              </td>
              {PACKAGE_TIERS.map((tier) => (
                <td
                  key={tier.key}
                  className={`py-3 px-4 text-center text-gray-200 font-medium whitespace-nowrap ${
                    selectedTierKey === tier.key ? 'bg-teal-400/[0.04]' : ''
                  }`}
                >
                  {tier.ekPlasiyerLabel}
                </td>
              ))}
            </tr>

            {/* Özellik Satırları */}
            {COMPARISON_FEATURE_ROWS.map((row) => (
              <tr key={row.label} className="hover:bg-white/[0.02] transition-colors">
                <td className="py-3 px-4 sm:px-5 font-semibold text-gray-200 sticky left-0 bg-[#111820] z-10">
                  {row.label}
                </td>
                {PACKAGE_TIERS.map((tier) => {
                  const isIncluded = row.values[tier.key];
                  return (
                    <td
                      key={tier.key}
                      className={`py-3 px-4 text-center ${
                        selectedTierKey === tier.key ? 'bg-teal-400/[0.04]' : ''
                      }`}
                    >
                      {isIncluded ? (
                        <span
                          aria-label={`${tier.title}: ${row.label} Dahil`}
                          className="inline-flex items-center justify-center w-5 h-5 rounded bg-emerald-500 text-white shadow-sm"
                        >
                          <Check className="w-3.5 h-3.5 stroke-[3]" />
                        </span>
                      ) : (
                        <span
                          aria-label={`${tier.title}: ${row.label} Dahil Değil`}
                          className="inline-flex items-center justify-center w-5 h-5 rounded text-red-500"
                        >
                          <X className="w-4 h-4 stroke-[3]" />
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
};
