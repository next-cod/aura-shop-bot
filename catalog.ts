export type ProductCategory = "privilege" | "case" | "service";

export type ProductPeriod = {
  id: "30" | "90" | "forever";
  title: string;
  price: number;
};

export type Product = {
  id: string;
  category: ProductCategory;
  title: string;
  price: number;
  oldPrice: number;
  emoji: string;
  image: string;
  description: string;
  perks: string[];
  periods?: ProductPeriod[];
};

const periods = (days30: number, days90: number, forever: number): ProductPeriod[] => [
  { id: "30", title: "30 дней", price: days30 },
  { id: "90", title: "90 дней", price: days90 },
  { id: "forever", title: "Навсегда", price: forever }
];

// Актуальные цены и изображения синхронизированы с Aura Site (js/aura-site.js).
export const catalog: Product[] = [
  { id: "scout", category: "privilege", title: "SCOUT", price: 9, oldPrice: 39, emoji: "🛡️", image: "scout.png", description: "Стартовая привилегия", perks: ["/kit scout, /craft, /getpos", "5 слотов на аукционе · 2 привата", "Включает возможности предыдущих рангов"], periods: periods(9, 20, 39) },
  { id: "warden", category: "privilege", title: "WARDEN", price: 19, oldPrice: 99, emoji: "⚔️", image: "warden.webp", description: "Усиленная привилегия", perks: ["/kit warden, /hat, /feed, /rtp far", "7 слотов · 4 привата · 3 дома", "Включает SCOUT"], periods: periods(19, 59, 99) },
  { id: "titan", category: "privilege", title: "TITAN", price: 29, oldPrice: 190, emoji: "🔥", image: "titan.png", description: "Для уверенной игры", perks: ["/kit titan, /enderchest, /anvil, /clear", "9 слотов · 8 приватов · 6 домов", "Включает WARDEN и SCOUT"], periods: periods(29, 109, 190) },
  { id: "magister", category: "privilege", title: "MAGISTER", price: 59, oldPrice: 390, emoji: "👑", image: "magister.png", description: "Продвинутый уровень", perks: ["/kit magister, /repair, /near, /ptime", "14 слотов · 16 приватов · 12 домов", "Включает предыдущие ранги"], periods: periods(59, 219, 390) },
  { id: "reaper", category: "privilege", title: "REAPER", price: 119, oldPrice: 790, emoji: "☠️", image: "reaper.png", description: "Топовый статус AURA", perks: ["/kit reaper, /nick, /invsee, /heal", "22 слота · 40 приватов · 32 дома", "Деньги с мобов ×1,5"], periods: periods(119, 439, 790) },
  { id: "phoenix", category: "privilege", title: "PHOENIX", price: 199, oldPrice: 1290, emoji: "🦅", image: "phoenix.png", description: "Премиальный статус", perks: ["/kit phoenix, /broadcast, управление погодой", "96 приватов · 48 домов", "Деньги с мобов ×2"], periods: periods(199, 699, 1290) },
  { id: "dragon", category: "privilege", title: "DRAGON", price: 299, oldPrice: 1990, emoji: "🐉", image: "dragon.png", description: "Максимальный статус AURA", perks: ["/kit dragon, /fly, /grant SCOUT", "999 приватов и домов", "Деньги с мобов ×3"], periods: periods(299, 1090, 1990) },
  { id: "sigma", category: "privilege", title: "SIGMA", price: 749, oldPrice: 4990, emoji: "💠", image: "sigma.webp", description: "Ультимативный статус AURA", perks: ["Все возможности DRAGON", "/kit sigma, /mute", "Связь с администрацией · деньги с мобов ×5"], periods: periods(749, 2790, 4990) },
  { id: "donate-case-3", category: "case", title: "3 донат-кейса", price: 90, oldPrice: 90, emoji: "🎉", image: "3 донат-кейса.webp", description: "Набор донат-кейсов", perks: ["3 ключа", "Выдача на игровой аккаунт"] },
  { id: "donate-case-10", category: "case", title: "10 донат-кейсов", price: 249, oldPrice: 249, emoji: "🎉", image: "10 донат-кейсов.webp", description: "Набор донат-кейсов", perks: ["10 ключей", "Выдача на игровой аккаунт"] },
  { id: "donate-case-25", category: "case", title: "25 донат-кейсов", price: 399, oldPrice: 399, emoji: "🎉", image: "25 донат-кейсов.webp", description: "Набор донат-кейсов", perks: ["25 ключей", "Выдача на игровой аккаунт"] },
  { id: "currency-case-3", category: "case", title: "3 кейса с валютой", price: 46, oldPrice: 46, emoji: "💰", image: "3 кейса с валютой.webp", description: "Набор кейсов с валютой", perks: ["3 ключа", "Выдача на игровой аккаунт"] },
  { id: "currency-case-10", category: "case", title: "10 кейсов с валютой", price: 149, oldPrice: 149, emoji: "💰", image: "10 кейсов с валютой.webp", description: "Набор кейсов с валютой", perks: ["10 ключей", "Выдача на игровой аккаунт"] },
  { id: "currency-case-25", category: "case", title: "25 кейсов с валютой", price: 399, oldPrice: 399, emoji: "💰", image: "25 кейсов с валютой.webp", description: "Набор кейсов с валютой", perks: ["25 ключей", "Выдача на игровой аккаунт"] },
  { id: "aura-case-1", category: "case", title: "1 кейс с аурой", price: 59, oldPrice: 59, emoji: "🔴", image: "1 кейс с аурой.webp", description: "Кейс с аурой", perks: ["1 ключ", "Выдача на игровой аккаунт"] },
  { id: "aura-case-3", category: "case", title: "3 кейса с аурой", price: 149, oldPrice: 149, emoji: "🔴", image: "3 кейса с аурой.webp", description: "Набор кейсов с аурой", perks: ["3 ключа", "Выдача на игровой аккаунт"] },
  { id: "aura-case-5", category: "case", title: "5 кейсов с аурой", price: 239, oldPrice: 239, emoji: "🔴", image: "5 кейсов с аурой.webp", description: "Набор кейсов с аурой", perks: ["5 ключей", "Выдача на игровой аккаунт"] },
  { id: "unban", category: "service", title: "Разбан", price: 349, oldPrice: 349, emoji: "🔓", image: "Разбан.png", description: "Снятие блокировки", perks: ["Выдаётся после оплаты"] },
  { id: "unmute", category: "service", title: "Размут", price: 119, oldPrice: 119, emoji: "🔊", image: "Размут.png", description: "Снятие мута", perks: ["Выдаётся после оплаты"] }
];

export const productsBy = (category: ProductCategory) => catalog.filter((product) => product.category === category);
export const productById = (id: string) => catalog.find((product) => product.id === id);
