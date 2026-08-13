export type ProductCategory = "privilege" | "aura" | "case";

export type Product = {
  id: string;
  category: ProductCategory;
  title: string;
  price: number;
  emoji: string;
  description: string;
  perks: string[];
};

// Prices for privileges are synced with AuraServerD/src/main/resources/config.yml.
// Update Aura and case packages here whenever the website catalogue changes.
export const catalog: Product[] = [
  { id: "hero", category: "privilege", title: "HERO", price: 39, emoji: "🛡", description: "Стартовая привилегия", perks: ["Базовые бонусы", "Выдача на игровой аккаунт"] },
  { id: "vip", category: "privilege", title: "VIP", price: 49, emoji: "💎", description: "Больше комфорта в выживании", perks: ["3 дома", "/workbench и /hat", "Набор /kit vip"] },
  { id: "avenger", category: "privilege", title: "AVENGER", price: 99, emoji: "⚔️", description: "Усиленная привилегия", perks: ["Дополнительные возможности", "Выдача на игровой аккаунт"] },
  { id: "premium", category: "privilege", title: "PREMIUM", price: 190, emoji: "🔥", description: "Для уверенной игры", perks: ["7 домов", "/enderchest и /anvil", "Набор /kit premium"] },
  { id: "magistr", category: "privilege", title: "MAGISTR", price: 390, emoji: "👑", description: "Продвинутый уровень", perks: ["Расширенные возможности", "Выдача на игровой аккаунт"] },
  { id: "legend", category: "privilege", title: "LEGEND", price: 499, emoji: "🌋", description: "Свобода и максимум удобства", perks: ["15 домов", "/fly, /feed, /heal, /repair", "Набор /kit legend"] },
  { id: "imperator", category: "privilege", title: "IMPERATOR", price: 790, emoji: "🏰", description: "Топовая привилегия", perks: ["Эксклюзивные возможности", "Выдача на игровой аккаунт"] },
  { id: "phoenix", category: "privilege", title: "PHOENIX", price: 1290, emoji: "🦅", description: "Премиальный статус", perks: ["Эксклюзивные возможности", "Выдача на игровой аккаунт"] },
  { id: "dragon", category: "privilege", title: "DRAGON", price: 1990, emoji: "🐉", description: "Максимальный статус Aura", perks: ["Эксклюзивные возможности", "Выдача на игровой аккаунт"] },
  { id: "aura-100", category: "aura", title: "100 Ауры", price: 99, emoji: "🔴", description: "Донатная валюта Aura", perks: ["Начисление на игровой аккаунт"] },
  { id: "aura-500", category: "aura", title: "500 Ауры", price: 399, emoji: "🔴", description: "Выгодный набор", perks: ["Начисление на игровой аккаунт", "Выгода 19%"] },
  { id: "aura-1000", category: "aura", title: "1000 Ауры", price: 699, emoji: "🔴", description: "Максимальная выгода", perks: ["Начисление на игровой аккаунт", "Выгода 30%"] },
  { id: "case-money", category: "case", title: "Денежный кейс", price: 79, emoji: "📦", description: "Ключ от кейса с игровой валютой", perks: ["1 ключ", "Выдача на игровой аккаунт"] },
  { id: "case-aura", category: "case", title: "Aura-кейс", price: 149, emoji: "🎁", description: "Ключ от кейса с Аурой", perks: ["1 ключ", "Выдача на игровой аккаунт"] },
  { id: "case-donate", category: "case", title: "Донат-кейс", price: 299, emoji: "🎉", description: "Ключ от кейса с привилегиями", perks: ["1 ключ", "Выдача на игровой аккаунт"] }
];

export const productsBy = (category: ProductCategory) => catalog.filter((product) => product.category === category);
export const productById = (id: string) => catalog.find((product) => product.id === id);
