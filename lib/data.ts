import { Receipt, Landmark, Users, FileSpreadsheet, Handshake, Calculator, type LucideIcon } from "lucide-react";

/* ===== AYARLAR: yayına çıkmadan burayı doldurun ===== */
export const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://fatihg8558-dev.github.io/e-tahsilatapp/"; // uygulamanızın web adresi
export const CONTACT_EMAIL = "destek@ornek.com";               // TODO: gerçek adres
// Gerçek referans logoları ve müşteri yorumları olmadan bu bölümleri AÇMAYIN.
export const SHOW_LOGOS = false;
export const SHOW_TESTIMONIALS = false;

export const NAV = [
  { href: "#ozellikler", label: "Özellikler" },
  { href: "#nasil", label: "Çözümler" },
  { href: "#fiyat", label: "Fiyatlandırma" },
  { href: "#sss", label: "SSS" },
  { href: "#iletisim", label: "İletişim" },
];

export type Feature = { icon: LucideIcon; title: string; text: string; wide?: boolean };
export const FEATURES: Feature[] = [
  { icon: Receipt, wide: true, title: "Tahsilat ve tediye makbuzu",
    text: "Nakit, kredi kartı, çek ve senet. Makbuzu tek bir linkle WhatsApp veya e-postayla müşterinize gönderin; müşteri yazdırır veya PDF kaydeder." },
  { icon: Landmark, title: "Çek ve senet kaydı",
    text: "Belge no, vade ve banka adı her kayıtta. Senet için açıklama alanı." },
  { icon: Users, title: "Plasiyer ve alt hesaplar",
    text: "Plasiyerler sahada tahsilat yapar, gün sonunda ana hesaba aktarır. İşlemi kimin yaptığı kayıtta kalır." },
  { icon: FileSpreadsheet, title: "Excel ve PDF çıktı",
    text: "Cari ekstreyi PDF gönderin. Tahsilat ve tediye listesini türlere göre sütunlu Excel alın." },
  { icon: Handshake, title: "Mutabakat",
    text: "Carilerinize mutabakat gönderin, cevaplar ana hesabınıza düşsün. Mutabık değilseniz Excel veya PDF ekleyebilirler." },
  { icon: Calculator, title: "Muhasebeci paneli",
    text: "UBL/XML faturaları mevcut carilere işleyin. Carisi olmayan fatura için cari aç veya yok say seçeneği." },
];

export const STEPS = [
  { title: "Hesabınızı oluşturun", text: "Firma bilgilerinizi girin, 7 günlük denemeniz başlasın. Kredi kartı gerekmez." },
  { title: "Cari ve plasiyerlerinizi tanımlayın", text: "Ünvan, vergi/TC no, telefon ve e-posta yeterli. Plasiyerlerinizi davet edin." },
  { title: "Tahsilatı anında kaydedin", text: "Sahadan veya ofisten kaydedin, makbuzu müşteriye hemen gönderin." },
];

/* TODO: fiyatları ve plan içeriklerini kendinize göre değiştirin (aşağıdakiler örnektir). */
export type Plan = { name: string; monthly: number | null; desc: string; popular?: boolean; cta: string; features: string[] };
export const PLANS: Plan[] = [
  { name: "Başlangıç", monthly: 299, desc: "Tek işletme, sahadaki küçük ekipler için.", cta: "7 gün ücretsiz dene",
    features: ["Ana hesap + 5 plasiyer dahil", "Tahsilat ve tediye makbuzu", "Çek / senet kaydı", "Cari ekstre PDF", "WhatsApp ve e-posta ile makbuz"] },
  { name: "Profesyonel", monthly: 599, popular: true, desc: "Muhasebeciyle çalışan işletmeler için.", cta: "7 gün ücretsiz dene",
    features: ["Başlangıç’taki her şey", "Muhasebeci paneli", "UBL/XML fatura yükleme", "Excel tahsilat/tediye listesi", "Mutabakat gönderme ve takip"] },
  { name: "Kurumsal", monthly: null, desc: "Çok plasiyerli, yoğun işlem hacimli firmalar.", cta: "Teklif alın",
    features: ["Profesyonel’deki her şey", "Ek plasiyer paketleri", "Sınırsız kullanım seçeneği", "Öncelikli destek"] },
];

export const FAQ = [
  { q: "Deneme süresi nasıl işliyor?", a: "Kayıt olduğunuzda 7 gün boyunca ücretsiz kullanırsınız. Kredi kartı istenmez." },
  { q: "Ödemeyi nasıl yapıyorum?", a: "Paket ödemesi IBAN/havale ile yapılır. Dekontu uygulamadan yüklersiniz, ödeme onaylanınca süreniz seçtiğiniz pakete göre uzatılır." },
  { q: "Kaç plasiyer tanımlayabilirim?", a: "Pakete 5 plasiyer dahildir. Sonraki her plasiyer için ek ücret uygulanır." },
  { q: "Makbuzu müşteriye nasıl gönderirim?", a: "Makbuzun linkini WhatsApp veya e-posta ile paylaşırsınız. Müşteri linke tıklayıp makbuzu görür, yazdırır veya PDF kaydeder." },
  { q: "Verilerim güvende mi?", a: "Her firmanın verisi birbirinden ayrıdır; kullanıcılar yalnızca kendi firmalarının kayıtlarına erişir." },
  { q: "Diğer firmalarla tahsilat bildirimi yapılabiliyor mu?", a: "Evet. Uygulamayı kullanan bir firmaya tahsilat/tediye bildirimi gönderebilirsiniz; onay verirse cariye işlenir. Eşleştirme vergi veya TC numarasıyla yapılır." },
];

/* Gerçek müşteri yorumlarıyla değiştirip SHOW_TESTIMONIALS'ı true yapın. */
export const TESTIMONIALS = [
  { name: "Ad Soyad", role: "Firma sahibi, Firma Adı", text: "Gerçek müşteri yorumunu buraya yazın.", stars: 5 },
];

/* Paket ödemesi için IBAN bilgisi: hesap sayfasında gösterilir. Boş bırakırsanız e-posta adresi gösterilir. */
export const IBAN = "";        // TODO: örn. "TR00 0000 0000 0000 0000 0000 00"
export const IBAN_SAHIBI = ""; // TODO: hesap sahibi adı
