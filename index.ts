import "dotenv/config";
import { randomUUID } from "node:crypto";
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
type Pending = { type: "ticket"; kind: TicketKind } | { type: "nick"; productId: string };
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
  return ctx.editMessageText("<b>🛒 Магазин Aura</b>\n\nВыбери, что хочешь приобрести. Перед оплатой бот попросит игровой ник — на него придёт покупка.", {
    parse_mode: "HTML",
    ...Markup.inlineKeyboard([
      [Markup.button.callback("👑 Привилегии", "category:privilege")],
      [Markup.button.callback("🔴 Аура", "category:aura"), Markup.button.callback("🎁 Кейсы", "category:case")],
      [Markup.button.url("🌐 Открыть магазин на сайте", links.site)],
      [Markup.button.callback("← В меню", "home")]
    ])
  });
}

function categoryTitle(category: ProductCategory) {
  return ({ privilege: "👑 Привилегии", aura: "🔴 Аура", case: "🎁 Кейсы" })[category];
}
async function showCategory(ctx: Context, category: ProductCategory) {
  await safeAnswer(ctx);
  const rows = productsBy(category).map((product) => [Markup.button.callback(`${product.emoji} ${product.title} — ${money(product.price)}`, `product:${product.id}`)]);
  rows.push([Markup.button.callback("← К категориям", "shop")]);
  return ctx.editMessageText(`<b>${categoryTitle(category)}</b>\n\nАктуальные позиции Aura. Нажми на товар, чтобы посмотреть состав и купить.`, { parse_mode: "HTML", ...Markup.inlineKeyboard(rows) });
}
async function showProduct(ctx: Context, product: Product) {
  await safeAnswer(ctx);
  const perks = product.perks.map((perk) => `• ${perk}`).join("\n");
  return ctx.editMessageText(`<b>${product.emoji} ${product.title}</b>\n${product.description}\n\n${perks}\n\n<b>Стоимость: ${money(product.price)}</b>`, {
    parse_mode: "HTML",
    ...Markup.inlineKeyboard([
      [Markup.button.callback("💳 Купить в Telegram", `buy:${product.id}`)],
      [Markup.button.url("🌐 Купить на сайте", links.site)],
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
bot.action(/^category:(privilege|aura|case)$/, (ctx) => showCategory(ctx, ctx.match[1] as ProductCategory));
bot.action(/^product:(.+)$/, async (ctx) => { const product = productById(ctx.match[1]); if (product) await showProduct(ctx, product); else await safeAnswer(ctx, "Товар не найден"); });
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
  pending.set(ctx.from.id, { type: "nick", productId: product.id });
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
  const nick = ctx.message.text.trim();
  if (!/^[a-zA-Z0-9_]{3,16}$/.test(nick)) return ctx.reply("Ник должен быть от 3 до 16 символов: латинские буквы, цифры и _. Попробуй ещё раз.");
  const product = productById(state.productId);
  if (!product) { pending.delete(ctx.from.id); return ctx.reply("Товар больше недоступен. Открой магазин заново.", mainKeyboard()); }
  const order: Order = { id: randomUUID().slice(0, 8).toUpperCase(), productId: product.id, minecraftNick: nick, createdAt: new Date().toISOString(), user: userData(ctx) };
  await saveOrder(order);
  pending.delete(ctx.from.id);
  if (!providerToken) {
    await sendStaff(`<b>🛒 Новый заказ #${order.id}</b>\n${product.emoji} ${product.title} · ${money(product.price)}\nНик: <code>${nick}</code>\nПокупатель: ${order.user.name} · <code>${order.user.id}</code>\n<i>Оплата в боте ещё не подключена — пользователь направлен на сайт.</i>`);
    return ctx.reply(`<b>Заказ #${order.id} подготовлен.</b>\nОплата в Telegram ещё подключается, поэтому заверши покупку на сайте. Укажи там ник <code>${nick}</code>.`, { parse_mode: "HTML", ...Markup.inlineKeyboard([[Markup.button.url("💳 Перейти к оплате", links.site)], [Markup.button.callback("← В меню", "home")]]) });
  }
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
process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
