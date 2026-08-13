export type ProductCategory = "privilege" | "case" | "service";

export type Product = {
  id: string;
  category: ProductCategory;
  title: string;
  price: number;
  oldPrice: number;
  emoji: string;
  description: string;
  perks: string[];
};

// Catalogue copied from Aura Site (js/aura-site.js). The current campaign is -40%
// and every `price` below is the discounted price actually charged in the bot.
export const catalog: Product[] = [
  { id: "scout", category: "privilege", title: "SCOUT", price: 23, oldPrice: 39, emoji: "🛡️", description: "Стартовая привилегия", perks: ["Выдача на игровой аккаунт"] },
  { id: "warden", category: "privilege", title: "WARDEN", price: 59, oldPrice: 99, emoji: "⚔️", description: "Усиленная привилегия", perks: ["Выдача на игровой аккаунт"] },
  { id: "titan", category: "privilege", title: "TITAN", price: 114, oldPrice: 190, emoji: "🔥", description: "Для уверенной игры", perks: ["Выдача на игровой аккаунт"] },
  { id: "magister", category: "privilege", title: "MAGISTER", price: 234, oldPrice: 390, emoji: "👑", description: "Продвинутый уровень", perks: ["Выдача на игровой аккаунт"] },
  { id: "reaper", category: "privilege", title: "REAPER", price: 474, oldPrice: 790, emoji: "☠️", description: "Топовый статус Aura", perks: ["Выдача на игровой аккаунт"] },
  { id: "phoenix", category: "privilege", title: "PHOENIX", price: 774, oldPrice: 1290, emoji: "🦅", description: "Премиальный статус", perks: ["Выдача на игровой аккаунт"] },
  { id: "dragon", category: "privilege", title: "DRAGON", price: 1194, oldPrice: 1990, emoji: "🐉", description: "Максимальный статус Aura", perks: ["Выдача на игровой аккаунт"] },
  { id: "sigma", category: "privilege", title: "SIGMA", price: 2994, oldPrice: 4990, emoji: "💠", description: "Ультимативный статус Aura", perks: ["Выдача на игровой аккаунт"] },
  { id: "donate-case-3", category: "case", title: "3 донат-кейса", price: 54, oldPrice: 90, emoji: "🎉", description: "Набор донат-кейсов", perks: ["3 ключа", "Выдача на игровой аккаунт"] },
  { id: "donate-case-10", category: "case", title: "10 донат-кейсов", price: 149, oldPrice: 249, emoji: "🎉", description: "Набор донат-кейсов", perks: ["10 ключей", "Выдача на игровой аккаунт"] },
  { id: "donate-case-25", category: "case", title: "25 донат-кейсов", price: 239, oldPrice: 399, emoji: "🎉", description: "Набор донат-кейсов", perks: ["25 ключей", "Выдача на игровой аккаунт"] },
  { id: "currency-case-3", category: "case", title: "3 кейса с валютой", price: 28, oldPrice: 46, emoji: "💰", description: "Набор кейсов с валютой", perks: ["3 ключа", "Выдача на игровой аккаунт"] },
  { id: "currency-case-10", category: "case", title: "10 кейсов с валютой", price: 89, oldPrice: 149, emoji: "💰", description: "Набор кейсов с валютой", perks: ["10 ключей", "Выдача на игровой аккаунт"] },
  { id: "currency-case-25", category: "case", title: "25 кейсов с валютой", price: 239, oldPrice: 399, emoji: "💰", description: "Набор кейсов с валютой", perks: ["25 ключей", "Выдача на игровой аккаунт"] },
  { id: "aura-case-1", category: "case", title: "1 кейс с аурой", price: 47, oldPrice: 79, emoji: "🔴", description: "Кейс с аурой", perks: ["1 ключ", "Выдача на игровой аккаунт"] },
  { id: "aura-case-3", category: "case", title: "3 кейса с аурой", price: 143, oldPrice: 239, emoji: "🔴", description: "Набор кейсов с аурой", perks: ["3 ключа", "Выдача на игровой аккаунт"] },
  { id: "aura-case-5", category: "case", title: "5 кейсов с аурой", price: 227, oldPrice: 379, emoji: "🔴", description: "Набор кейсов с аурой", perks: ["5 ключей", "Выдача на игровой аккаунт"] },
  { id: "unban", category: "service", title: "Разбан", price: 209, oldPrice: 349, emoji: "🔓", description: "Снятие блокировки", perks: ["После проверки администрацией"] },
  { id: "unmute", category: "service", title: "Размут", price: 71, oldPrice: 119, emoji: "🔊", description: "Снятие мута", perks: ["После проверки администрацией"] }
];

export const productsBy = (category: ProductCategory) => catalog.filter((product) => product.category === category);
export const productById = (id: string) => catalog.find((product) => product.id === id);
