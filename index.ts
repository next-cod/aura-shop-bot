import "dotenv/config";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { Telegraf, Markup, type Context } from "telegraf";
import { productById, productsBy, type Product, type ProductCategory } from "./catalog.js";
import { markOrderPaid, saveOrder, saveTicket, type Order, type TicketKind } from "./store.js";

const token = process.env.BOT_TOKEN;
if (!token) throw new Error("BOT_TOKEN is missing. Copy .env.example to .env and add the bot token.");

const bot = new Telegraf(token);
const links = {
  site: process.env.SITE_URL || "https://mcaura.ru",
  discord: process.env.DISCORD_URL || "https://discord.gg/JP6jSt7DA",
  telegram: process.env.TELEGRAM_CHANNEL_URL || "https://t.me/aura_grief"
};
const staffChatId = Number(process.env.STAFF_CHAT_ID || 0) || undefined;
const providerToken = process.env.PAYMENT_PROVIDER_TOKEN;
type Purchase = Pick<Product, "id" | "category" | "title" | "price" | "emoji" | "description" | "perks"> & { auraAmount?: number };
type Pending = { type: "ticket"; kind: TicketKind } | { type: "nick"; purchase: Purchase } | { type: "auraAmount" };
const pending = new Map<number, Pending>();

const mainKeyboard = () => Markup.inlineKeyboard([
  [Markup.button.callback("🛒 Магазин Aura", "shop"), Markup.button.callback("🧭 Обращения", "help")],
  [Markup.button.callback("📋 Заявки в команду", "applications"), Markup.button.url("💬 Discord", links.discord)],
  [Markup.button.url("🌐 Сайт", links.site), Markup.button.url("📢 Новости", links.telegram)]
]);
const backKeyboard = () => Markup.inlineKeyboard([[Markup.button.callback("← В главное меню", "home")]]);
const safeAnswer = (ctx: Context, text?: string) => ctx.answerCbQuery(text).catch(() => undefined);
const displayName = (ctx: Context) => [ctx.from?.first_name, ctx.from?.last_name].filter(Boolean).join(" ") || "Игрок";
const userData = (ctx: Context) => ({ id: ctx.from!.id, username: ctx.from?.username, name: displayName(ctx) });
const money = (value: number) => new Intl.NumberFormat("ru-RU").format(value) + " ₽";

async function showHome(ctx: Context, edit = false) {
  const text = "<b>🔴 AURA</b>\n<i>Твой путь на сервере начинается здесь.</i>\n\nВыбирай раздел — магазин, обращения или заявки в команду.";
  if (edit && ctx.callbackQuery) return ctx.editMessageText(text, { parse_mode: "HTML", ...mainKeyboard() });
  return ctx.reply(text, { parse_mode: "HTML", ...mainKeyboard() });
}

async function showShop(ctx: Context) {
  await safeAnswer(ctx);
  return ctx.editMessageText("<b>🛒 Магазин Aura</b>\n<i>🔥 Скидка 40% на все позиции</i>\n\nВыбери товар. Перед оплатой бот попросит игровой ник — покупка будет выдана на него.", {
    parse_mode: "HTML",
    ...Markup.inlineKeyboard([
      [Markup.button.callback("👑 Привилегии", "category:privilege")],
      [Markup.button.callback("🔴 Купить Ауру", "aura:custom"), Markup.button.callback("🎁 Кейсы", "category:case")],
      [Markup.button.callback("🔓 Услуги", "category:service")],
      [Markup.button.callback("← В меню", "home")]
    ])
  });
}

function categoryTitle(category: ProductCategory) {
  return ({ privilege: "👑 Привилегии", case: "🎁 Кейсы", service: "🔓 Услуги" })[category];
}
async function showCategory(ctx: Context, category: ProductCategory) {
  await safeAnswer(ctx);
  const rows = productsBy(category).map((product) => [Markup.button.callback(`${product.emoji} ${product.title} · ${money(product.oldPrice)} → ${money(product.price)} 🔥`, `product:${product.id}`)]);
  rows.push([Markup.button.callback("← К категориям", "shop")]);
  return ctx.editMessageText(`<b>${categoryTitle(category)}</b>\n<i>🔥 Все цены уже со скидкой 40%</i>\n\nНажми на товар, чтобы посмотреть состав и купить прямо в Telegram.`, { parse_mode: "HTML", ...Markup.inlineKeyboard(rows) });
}
async function showProduct(ctx: Context, product: Product) {
  await safeAnswer(ctx);
  const perks = product.perks.map((perk) => `• ${perk}`).join("\n");
  return ctx.editMessageText(`<b>${product.emoji} ${product.title}</b>\n${product.description}\n\n${perks}\n\n<s>${money(product.oldPrice)}</s> → <b>${money(product.price)}</b> <i>🔥 −40%</i>`, {
    parse_mode: "HTML",
    ...Markup.inlineKeyboard([
      [Markup.button.callback("💳 Купить в Telegram", `buy:${product.id}`)],
      [Markup.button.callback("← К списку", `category:${product.category}`)]
    ])
  });
}
async function showHelp(ctx: Context) {
  await safeAnswer(ctx);
  return ctx.editMessageText("<b>🧭 Обращения</b>\n\nКоманда Aura читает каждое обращение. За полезную идею или подтверждённый баг можно получить награду. Для жалобы прикладывай ник, описание и, если есть, доказательства.", {
    parse_mode: "HTML",
    ...Markup.inlineKeyboard([
      [Markup.button.callback("💡 Предложить улучшение", "ticket:idea")],
      [Markup.button.callback("🐞 Сообщить о баге", "ticket:bug"), Markup.button.callback("🚨 Пожаловаться", "ticket:report")],
      [Markup.button.callback("← В меню", "home")]
    ])
  });
}
async function sendStaff(text: string) {
  if (!staffChatId) return;
  await bot.telegram.sendMessage(staffChatId, text, { parse_mode: "HTML" }).catch((error) => console.error("Unable to send staff notification", error));
}

bot.start((ctx) => showHome(ctx));
bot.command("menu", (ctx) => showHome(ctx));
bot.action("home", async (ctx) => { pending.delete(ctx.from.id); await safeAnswer(ctx); await showHome(ctx, true); });
bot.action("shop", showShop);
bot.action("help", showHelp);
bot.action("applications", async (ctx) => {
  await safeAnswer(ctx);
  await ctx.editMessageText("<b>📋 Заявки в команду Aura</b>\n\nЗаявки не заполняются в боте. Перейди на Discord-сервер Aura и выбери нужную форму:\n\n• Helper\n• Медиа-команда — YouTube или TikTok\n• Другие открытые роли\n\nТам же можно следить за статусом заявки.", { parse_mode: "HTML", ...Markup.inlineKeyboard([[Markup.button.url("Открыть Discord Aura", links.discord)], [Markup.button.callback("← В меню", "home")]]) });
});
bot.action(/^category:(privilege|case|service)$/, (ctx) => showCategory(ctx, ctx.match[1] as ProductCategory));
bot.action(/^product:(.+)$/, async (ctx) => { const product = productById(ctx.match[1]); if (product) await showProduct(ctx, product); else await safeAnswer(ctx, "Товар не найден"); });
bot.action("aura:custom", async (ctx) => {
  pending.set(ctx.from.id, { type: "auraAmount" });
  await safeAnswer(ctx);
  await ctx.reply("<b>🔴 Пополнение Ауры</b>\n<i>🔥 Акция: 1 ₽ = 1,5 Ауры</i>\n\nНапиши, сколько Ауры тебе нужно — например: <code>150</code>.\nМинимум: 8 Ауры · максимум: 7 500 Ауры.", { parse_mode: "HTML", ...backKeyboard() });
});
bot.action(/^ticket:(idea|bug|report)$/, async (ctx) => {
  const kind = ctx.match[1] as TicketKind;
  pending.set(ctx.from.id, { type: "ticket", kind });
  await safeAnswer(ctx);
  const prompts: Record<TicketKind, string> = {
    idea: "💡 <b>Предложение по улучшению</b>\n\nОпиши идею: какую проблему она решает, как должна работать и почему это будет полезно игрокам.",
    bug: "🐞 <b>Сообщение о баге</b>\n\nНапиши, где найден баг, как его повторить и что произошло. Если есть видео или скрин, приложи ссылку прямо в описание.",
    report: "🚨 <b>Жалоба на игрока</b>\n\nУкажи ник игрока, нарушение, время и серверный режим. Добавь ссылку на видео или скриншоты, если они есть."
  };
  await ctx.reply(prompts[kind] + "\n\n<i>Чтобы отменить — /cancel</i>", { parse_mode: "HTML", ...backKeyboard() });
});
bot.action(/^buy:(.+)$/, async (ctx) => {
  const product = productById(ctx.match[1]);
  if (!product) return safeAnswer(ctx, "Товар не найден");
  pending.set(ctx.from.id, { type: "nick", purchase: product });
  await safeAnswer(ctx);
  await ctx.reply(`<b>Покупка: ${product.title}</b>\n\nНапиши свой игровой ник (латинские буквы, цифры и _). Товар будет выдан именно на этот аккаунт.`, { parse_mode: "HTML", ...backKeyboard() });
});
bot.command("cancel", async (ctx) => { pending.delete(ctx.from.id); await ctx.reply("Действие отменено.", mainKeyboard()); });

bot.on("text", async (ctx) => {
  const state = pending.get(ctx.from.id);
  if (!state || ctx.message.text.startsWith("/")) return;
  if (state.type === "ticket") {
    const text = ctx.message.text.trim();
    if (text.length < 15) return ctx.reply("Опиши обращение подробнее — хотя бы 15 символов.");
    const ticket = { id: randomUUID().slice(0, 8).toUpperCase(), kind: state.kind, text, createdAt: new Date().toISOString(), user: userData(ctx) };
    await saveTicket(ticket);
    pending.delete(ctx.from.id);
    const labels: Record<TicketKind, string> = { idea: "💡 ИДЕЯ", bug: "🐞 БАГ", report: "🚨 ЖАЛОБА" };
    await sendStaff(`<b>${labels[state.kind]} #${ticket.id}</b>\nОт: ${ticket.user.name}${ticket.user.username ? ` (@${ticket.user.username})` : ""} · <code>${ticket.user.id}</code>\n\n${text}`);
    return ctx.reply("<b>Готово — обращение отправлено команде Aura.</b>\nЕсли идею реализуют или баг подтвердится, с тобой свяжутся насчёт награды.", { parse_mode: "HTML", ...mainKeyboard() });
  }
  if (state.type === "auraAmount") {
    const requested = Number(ctx.message.text.trim().replace(",", "."));
    if (!Number.isInteger(requested) || requested < 8 || requested > 7500) return ctx.reply("Введи целое число от 8 до 7 500 — столько Ауры будет зачислено на игровой аккаунт.");
    const rubles = Math.max(5, Math.min(5000, Math.ceil(requested / 7.5) * 5));
    const credited = Math.round(rubles * 1.5);
    const purchase: Purchase = { id: `aura-${credited}-${rubles}`, category: "case", title: `${credited} Ауры`, price: rubles, emoji: "🔴", description: "Донатная валюта Aura", perks: ["Курс акции: 1 ₽ = 1,5 Ауры", `Будет зачислено: ${credited} Ауры`], auraAmount: credited };
    pending.set(ctx.from.id, { type: "nick", purchase });
    return ctx.reply(`<b>🔴 К зачислению: ${credited} Ауры</b>\nСтоимость: <b>${money(rubles)}</b>\n\nТеперь напиши игровой ник (латинские буквы, цифры и _).`, { parse_mode: "HTML", ...backKeyboard() });
  }
  const nick = ctx.message.text.trim();
  if (!/^[a-zA-Z0-9_]{3,16}$/.test(nick)) return ctx.reply("Ник должен быть от 3 до 16 символов: латинские буквы, цифры и _. Попробуй ещё раз.");
  const product = state.purchase;
  const order: Order = { id: randomUUID().slice(0, 8).toUpperCase(), productId: product.id, productTitle: product.title, amountRub: product.price, auraAmount: product.auraAmount, minecraftNick: nick, createdAt: new Date().toISOString(), user: userData(ctx) };
  await saveOrder(order);
  pending.delete(ctx.from.id);
  if (!providerToken) return ctx.reply("<b>Оплата в Telegram ещё не подключена.</b>\nАдминистратор должен добавить платёжный токен провайдера в настройки бота. Твой заказ не был оплачен.", { parse_mode: "HTML", ...mainKeyboard() });
  await ctx.replyWithInvoice({ title: `${product.title} — Aura`, description: `${product.description}. Выдача на ник ${nick}.`, payload: `aura:${order.id}`, provider_token: providerToken, currency: "RUB", prices: [{ label: product.title, amount: product.price * 100 }] });
});

bot.on("pre_checkout_query", async (ctx) => { await ctx.answerPreCheckoutQuery(true); });
bot.on("successful_payment", async (ctx) => {
  const orderId = ctx.message.successful_payment.invoice_payload.replace("aura:", "");
  await markOrderPaid(orderId);
  await sendStaff(`<b>✅ ОПЛАЧЕН ЗАКАЗ #${orderId}</b>\nПокупатель: ${displayName(ctx)} · <code>${ctx.from.id}</code>\nПроверьте заказ в data/aura-bot.json и выдайте товар на указанный ник.`);
  await ctx.reply("<b>Оплата прошла! 🎉</b>\nЗаказ передан команде Aura на выдачу. Мы выдадим покупку на указанный игровой ник.", { parse_mode: "HTML", ...mainKeyboard() });
});

bot.catch((error) => console.error("Bot error", error));
bot.launch().then(() => console.log("Aura bot is running"));

// Amvera checks that an application keeps its assigned HTTP port open.
// The bot itself uses Telegram long polling; this endpoint only reports liveness.
const healthPort = Number(process.env.PORT || 80);
createServer((_request, response) => {
  response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify({ status: "ok", service: "aura-telegram-bot" }));
}).listen(healthPort, "0.0.0.0", () => console.log(`Health check listening on ${healthPort}`));

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
