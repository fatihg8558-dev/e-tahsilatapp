export function formatCurrency(amount: number | null | undefined, includeSymbol: boolean = true): string {
  const val = Number(amount) || 0;
  const formatted = new Intl.NumberFormat('tr-TR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(val);

  return includeSymbol ? `${formatted} ₺` : formatted;
}

export function formatDate(dateString: string | null | undefined): string {
  if (!dateString) return '-';
  try {
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return dateString;
    return new Intl.DateTimeFormat('tr-TR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).format(date);
  } catch {
    return dateString;
  }
}

export function getGreeting(name?: string): string {
  const hour = new Date().getHours();
  let greeting = 'İyi günler';
  if (hour >= 6 && hour < 11) {
    greeting = 'Günaydın';
  } else if (hour >= 11 && hour < 18) {
    greeting = 'İyi günler';
  } else {
    greeting = 'İyi akşamlar';
  }

  return name ? `${greeting}, ${name}` : greeting;
}

// Sayıyı Türkçe yazıya çevirici (Makbuz için: "Yalnızca Yüz Elli Türk Lirası")
export function numberToTurkishWords(num: number): string {
  const birler = ['', 'Bir', 'İki', 'Üç', 'Dört', 'Beş', 'Altı', 'Yedi', 'Sekiz', 'Dokuz'];
  const onlar = ['', 'On', 'Yirmi', 'Otuz', 'Kırk', 'Elli', 'Altmış', 'Yetmiş', 'Seksen', 'Doksan'];
  const basamaklar = ['', 'Bin', 'Milyon', 'Milyar'];

  if (num === 0) return 'Sıfır Türk Lirası';

  const absNum = Math.abs(num);
  const lira = Math.floor(absNum);
  const kurus = Math.round((absNum - lira) * 100);

  function ucBasamak(n: number): string {
    let str = '';
    const y = Math.floor(n / 100);
    const o = Math.floor((n % 100) / 10);
    const b = n % 10;

    if (y > 0) {
      if (y === 1) str += 'Yüz ';
      else str += birler[y] + ' Yüz ';
    }
    if (o > 0) str += onlar[o] + ' ';
    if (b > 0) str += birler[b] + ' ';

    return str.trim();
  }

  let sonuc = '';
  let tempLira = lira;
  let basamakIndex = 0;

  while (tempLira > 0) {
    const parca = tempLira % 1000;
    if (parca > 0) {
      let parcaYazi = ucBasamak(parca);
      if (basamakIndex === 1 && parca === 1) {
        parcaYazi = ''; // 1 bin yerine sadece "Bin"
      }
      sonuc = (parcaYazi + (basamaklar[basamakIndex] ? ' ' + basamaklar[basamakIndex] : '') + ' ' + sonuc).trim();
    }
    tempLira = Math.floor(tempLira / 1000);
    basamakIndex++;
  }

  let finalStr = (sonuc || 'Sıfır') + ' Türk Lirası';
  if (kurus > 0) {
    finalStr += ' ' + ucBasamak(kurus) + ' Kuruş';
  }

  return 'Yalnızca ' + finalStr;
}
