export type ProductCategory = "privilege" | "case" | "service";

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
};

// Catalogue copied from Aura Site (js/aura-site.js). The current campaign is -40%
// and every `price` below is the discounted price actually charged in the bot.
export const catalog: Product[] = [
  { id: "scout", category: "privilege", title: "SCOUT", price: 23, oldPrice: 39, emoji: "🛡️", image: "scout.webp", description: "Стартовая привилегия", perks: ["/kit scout, /craft, /getpos", "5 слотов на аукционе · 2 привата", "Включает возможности предыдущих рангов"] },
  { id: "warden", category: "privilege", title: "WARDEN", price: 59, oldPrice: 99, emoji: "⚔️", image: "warden.webp", description: "Усиленная привилегия", perks: ["/kit warden, /hat, /feed, /rtp far", "7 слотов · 4 привата · 3 дома", "Включает SCOUT"] },
  { id: "titan", category: "privilege", title: "TITAN", price: 114, oldPrice: 190, emoji: "🔥", image: "titan.webp", description: "Для уверенной игры", perks: ["/kit titan, /enderchest, /anvil, /clear", "9 слотов · 8 приватов · 6 домов", "Включает WARDEN и SCOUT"] },
  { id: "magister", category: "privilege", title: "MAGISTER", price: 234, oldPrice: 390, emoji: "👑", image: "magister.webp", description: "Продвинутый уровень", perks: ["/kit magister, /repair, /near, /ptime", "14 слотов · 16 приватов · 12 домов", "Включает предыдущие ранги"] },
  { id: "reaper", category: "privilege", title: "REAPER", price: 474, oldPrice: 790, emoji: "☠️", image: "reaper.webp", description: "Топовый статус Aura", perks: ["/kit reaper, /nick, /invsee, /heal", "22 слота · 40 приватов · 32 дома", "Деньги с мобов ×1,5"] },
  { id: "phoenix", category: "privilege", title: "PHOENIX", price: 774, oldPrice: 1290, emoji: "🦅", image: "phoenix.webp", description: "Премиальный статус", perks: ["/kit phoenix, /broadcast, управление погодой", "96 приватов · 48 домов", "Деньги с мобов ×2"] },
  { id: "dragon", category: "privilege", title: "DRAGON", price: 1194, oldPrice: 1990, emoji: "🐉", image: "dragon.webp", description: "Максимальный статус Aura", perks: ["/kit dragon, /fly, /grant SCOUT", "999 приватов и домов", "Деньги с мобов ×3"] },
  { id: "sigma", category: "privilege", title: "SIGMA", price: 2994, oldPrice: 4990, emoji: "💠", image: "sigma.webp", description: "Ультимативный статус Aura", perks: ["Все возможности DRAGON", "/kit sigma, /mute", "Связь с администрацией · деньги с мобов ×5"] },
  { id: "donate-case-3", category: "case", title: "3 донат-кейса", price: 54, oldPrice: 90, emoji: "🎉", image: "3 донат-кейса.webp", description: "Набор донат-кейсов", perks: ["3 ключа", "Выдача на игровой аккаунт"] },
  { id: "donate-case-10", category: "case", title: "10 донат-кейсов", price: 149, oldPrice: 249, emoji: "🎉", image: "10 донат-кейсов.webp", description: "Набор донат-кейсов", perks: ["10 ключей", "Выдача на игровой аккаунт"] },
  { id: "donate-case-25", category: "case", title: "25 донат-кейсов", price: 239, oldPrice: 399, emoji: "🎉", image: "25 донат-кейсов.webp", description: "Набор донат-кейсов", perks: ["25 ключей", "Выдача на игровой аккаунт"] },
  { id: "currency-case-3", category: "case", title: "3 кейса с валютой", price: 28, oldPrice: 46, emoji: "💰", image: "3 кейса с валютой.webp", description: "Набор кейсов с валютой", perks: ["3 ключа", "Выдача на игровой аккаунт"] },
  { id: "currency-case-10", category: "case", title: "10 кейсов с валютой", price: 89, oldPrice: 149, emoji: "💰", image: "10 кейсов с валютой.webp", description: "Набор кейсов с валютой", perks: ["10 ключей", "Выдача на игровой аккаунт"] },
  { id: "currency-case-25", category: "case", title: "25 кейсов с валютой", price: 239, oldPrice: 399, emoji: "💰", image: "25 кейсов с валютой.webp", description: "Набор кейсов с валютой", perks: ["25 ключей", "Выдача на игровой аккаунт"] },
  { id: "aura-case-1", category: "case", title: "1 кейс с аурой", price: 47, oldPrice: 79, emoji: "🔴", image: "1 кейс с аурой.webp", description: "Кейс с аурой", perks: ["1 ключ", "Выдача на игровой аккаунт"] },
  { id: "aura-case-3", category: "case", title: "3 кейса с аурой", price: 143, oldPrice: 239, emoji: "🔴", image: "3 кейса с аурой.webp", description: "Набор кейсов с аурой", perks: ["3 ключа", "Выдача на игровой аккаунт"] },
  { id: "aura-case-5", category: "case", title: "5 кейсов с аурой", price: 227, oldPrice: 379, emoji: "🔴", image: "5 кейсов с аурой.webp", description: "Набор кейсов с аурой", perks: ["5 ключей", "Выдача на игровой аккаунт"] },
  { id: "unban", category: "service", title: "Разбан", price: 209, oldPrice: 349, emoji: "🔓", image: "Разбан.webp", description: "Снятие блокировки", perks: ["После проверки администрацией"] },
  { id: "unmute", category: "service", title: "Размут", price: 71, oldPrice: 119, emoji: "🔊", image: "Размут.webp", description: "Снятие мута", perks: ["После проверки администрацией"] }
];

export const productsBy = (category: ProductCategory) => catalog.filter((product) => product.category === category);
export const productById = (id: string) => catalog.find((product) => product.id === id);
