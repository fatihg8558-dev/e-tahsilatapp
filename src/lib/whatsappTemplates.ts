import { formatCurrency, formatDate } from './formatters';
import { PortfoyDurum } from '../types/database';

export function buildVadeHatirlatmaMesaji(params: {
  firmaUnvan?: string | null;
  cariUnvan?: string | null;
  evrakTur: 'cek' | 'senet';
  belgeNo?: string | null;
  tutar: number;
  vadeTarihi?: string | null;
  diffDays?: number | null;
  portfoyDurumu?: PortfoyDurum;
}): string {
  const {
    firmaUnvan,
    cariUnvan,
    evrakTur,
    belgeNo,
    tutar,
    vadeTarihi,
    diffDays,
    portfoyDurumu,
  } = params;

  const evrakLabel = evrakTur === 'cek' ? 'çekiniz' : 'senediniz';
  const docPart = belgeNo ? `${belgeNo} numaralı ` : '';
  const vadePart = vadeTarihi ? formatDate(vadeTarihi) : 'belirtilen';
  const musteri = cariUnvan?.trim() || 'Değerli İş Ortağımız';
  const gonderen = firmaUnvan?.trim() || 'Firmamız';

  if (portfoyDurumu === 'karsiliksiz') {
    return [
      `Sayın ${musteri},`,
      '',
      `${vadePart} vadeli, ${docPart}${formatCurrency(tutar)} tutarındaki ${evrakLabel} banka nezdinde karşılıksız/ödenmemiş görünmektedir.`,
      'Ödeme veya yeni vade planı için tarafımızla iletişime geçmenizi rica ederiz.',
      '',
      'Saygılarımızla,',
      gonderen,
    ].join('\n');
  }

  let durumCumlesi = `${vadePart} vadeli, ${docPart}${formatCurrency(tutar)} tutarındaki ${evrakLabel} hakkında bilgilendirme yapmak isteriz.`;
  if (typeof diffDays === 'number') {
    if (diffDays < 0) {
      durumCumlesi = `${vadePart} vadeli, ${docPart}${formatCurrency(tutar)} tutarındaki ${evrakLabel}in vadesi ${Math.abs(diffDays)} gün geçmiştir.`;
    } else if (diffDays === 0) {
      durumCumlesi = `${vadePart} (bugün) vadeli, ${docPart}${formatCurrency(tutar)} tutarındaki ${evrakLabel}in ödeme günü bugün dolmaktadır.`;
    } else if (diffDays === 1) {
      durumCumlesi = `Yarın (${vadePart}) vadeli, ${docPart}${formatCurrency(tutar)} tutarındaki ${evrakLabel}i hatırlatmak isteriz.`;
    } else {
      durumCumlesi = `${vadePart} vadeli (${diffDays} gün sonra), ${docPart}${formatCurrency(tutar)} tutarındaki ${evrakLabel}i bilgilerinize sunarız.`;
    }
  }

  return [
    `Sayın ${musteri},`,
    '',
    durumCumlesi,
    'Ödeme planınızla ilgili bilgi paylaşabilirseniz memnuniyet duyarız.',
    '',
    'İyi çalışmalar dileriz.',
    gonderen,
  ].join('\n');
}

export function buildCariBorcHatirlatmaMesaji(params: {
  firmaUnvan?: string | null;
  cariUnvan?: string | null;
  bakiye: number;
  sonTarih?: string;
  ekNot?: string;
}): string {
  const { firmaUnvan, cariUnvan, bakiye, sonTarih, ekNot } = params;
  const musteri = cariUnvan?.trim() || 'Değerli İş Ortağımız';
  const gonderen = firmaUnvan?.trim() || 'Firmamız';
  const mutabakatTarihi = sonTarih || formatDate(new Date().toISOString());

  if (bakiye < -0.01) {
    return [
      `Sayın ${musteri},`,
      '',
      `${mutabakatTarihi} tarihi itibarıyla cari hesabınızda ${formatCurrency(Math.abs(bakiye))} alacak bakiyeniz bulunmaktadır.`,
      ekNot?.trim() ? ekNot.trim() : 'Ödeme ve mahsup planı için bilgi paylaşabilirsiniz.',
      '',
      'Saygılarımızla,',
      gonderen,
    ].join('\n');
  }

  return [
    `Sayın ${musteri},`,
    '',
    `${mutabakatTarihi} tarihi itibarıyla cari hesabınızda ${formatCurrency(Math.abs(bakiye))} açık borç bakiyesi bulunmaktadır.`,
    ekNot?.trim()
      ? ekNot.trim()
      : 'Ödeme planınız veya dekont paylaşımı için tarafımıza dönüş yapabilirsiniz.',
    '',
    'İyi çalışmalar dileriz.',
    gonderen,
  ].join('\n');
}
