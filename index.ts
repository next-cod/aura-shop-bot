import "dotenv/config";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { join } from "node:path";
import { Telegraf, Markup, Input, type Context } from "telegraf";
import { productById, productsBy, type Product, type ProductCategory } from "./catalog.js";
import { getManagerChatId, saveTicket, setManagerChatId, type TicketKind } from "./store.js";

const token = process.env.BOT_TOKEN;
if (!token) throw new Error("BOT_TOKEN is missing. Copy .env.example to .env and add the bot token.");

const bot = new Telegraf(token);
const links = {
  site: process.env.SITE_URL || "https://mcaura.ru",
  discord: process.env.DISCORD_URL || "https://discord.gg/JP6jSt7DA",
  telegram: process.env.TELEGRAM_CHANNEL_URL || "https://t.me/aura_grief"
};
const staffChatId = Number(process.env.STAFF_CHAT_ID || 0) || undefined;
const managerUsername = (process.env.MANAGER_USERNAME || "manager_mcaura").toLowerCase();
const asset = (name: string) => join(process.cwd(), "assets", name);
type Pending = { type: "ticket"; kind: TicketKind };
const pending = new Map<number, Pending>();

const mainKeyboard = () => Markup.inlineKeyboard([
  [Markup.button.callback("🛒 Магазин Aura", "shop"), Markup.button.callback("🧭 Обращения", "help")],
  [Markup.button.callback("🎮 О сервере", "server"), Markup.button.callback("📜 Правила", "rules")],
  [Markup.button.callback("📋 Заявки в команду", "applications"), Markup.button.url("💬 Discord", links.discord)],
  [Markup.button.url("📢 Канал сервера", links.telegram), Markup.button.url("👤 Канал создателя", "https://t.me/next_auramc")]
]);
const backKeyboard = () => Markup.inlineKeyboard([[Markup.button.callback("← В главное меню", "home")]]);
const safeAnswer = (ctx: Context, text?: string) => ctx.answerCbQuery(text).catch(() => undefined);
const displayName = (ctx: Context) => [ctx.from?.first_name, ctx.from?.last_name].filter(Boolean).join(" ") || "Игрок";
const userData = (ctx: Context) => ({ id: ctx.from!.id, username: ctx.from?.username, name: displayName(ctx) });
const money = (value: number) => new Intl.NumberFormat("ru-RU").format(value) + " ₽";

async function showHome(ctx: Context) {
  const text = "<b>🔴 AURA — ГРИФЕРСКИЙ СЕРВЕР</b>\n<i>🔥 Играй, сражайся, забирай своё.</i>\n\n🎮 <b>Для телефонов и компьютеров</b>\nВерсии: <b>1.16.5–26.2</b>\nРежим: <b>гриф-выживание</b>\n\n📢 Канал сервера: @aura_grief\n💬 Discord сервер: <a href=\"https://discord.gg/JP6jSt7DA\">discord.gg/JP6jSt7DA</a>\n👤 Канал создателя: @next_auramc\n\n<i>Выбирай раздел ниже — всё нужное в одном боте.</i>";
  return ctx.replyWithPhoto(Input.fromLocalFile(asset("aura-home.png")), { caption: text, parse_mode: "HTML", ...mainKeyboard() });
}

async function showShop(ctx: Context) {
  await safeAnswer(ctx);
  return ctx.reply("<b>🛒 Магазин Aura</b>\n<i>🔥 Скидка 40% на все позиции</i>\n\nВыбери товар. Перед оплатой бот попросит игровой ник — покупка будет выдана на него.", {
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
  return ctx.reply(`<b>${categoryTitle(category)}</b>\n<i>🔥 Все цены уже со скидкой 40%</i>\n\nНажми на товар, чтобы посмотреть состав и купить прямо в Telegram.`, { parse_mode: "HTML", ...Markup.inlineKeyboard(rows) });
}
async function showProduct(ctx: Context, product: Product) {
  await safeAnswer(ctx);
  const perks = product.perks.map((perk) => `• ${perk}`).join("\n");
  return ctx.replyWithPhoto(Input.fromLocalFile(asset(product.image)), { caption: `<b>${product.emoji} ${product.title}</b>\n${product.description}\n\n${perks}\n\n<s>${money(product.oldPrice)}</s> → <b>${money(product.price)}</b> <i>🔥 −40%</i>\n\n<b>🛒 Для покупки:</b> напиши менеджеру @manager_mcaura и укажи свой игровой ник и товар <b>${product.title}</b>.`,
    parse_mode: "HTML",
    ...Markup.inlineKeyboard([
      [Markup.button.callback("← К списку", `category:${product.category}`)]
    ])
  });
}
async function showHelp(ctx: Context) {
  await safeAnswer(ctx);
  return ctx.reply("<b>🧭 Обращения</b>\n\nКоманда Aura читает каждое обращение. За полезную идею или подтверждённый баг можно получить награду. Для жалобы прикладывай ник, описание и, если есть, доказательства.", {
    parse_mode: "HTML",
    ...Markup.inlineKeyboard([
      [Markup.button.callback("💡 Предложить улучшение", "ticket:idea")],
      [Markup.button.callback("🐞 Сообщить о баге", "ticket:bug"), Markup.button.callback("🚨 Пожаловаться", "ticket:report")],
      [Markup.button.callback("← В меню", "home")]
    ])
  });
}
async function sendStaff(text: string) {
  const recipient = staffChatId || await getManagerChatId();
  if (!recipient) return;
  await bot.telegram.sendMessage(recipient, text, { parse_mode: "HTML" }).catch((error) => console.error("Unable to send staff notification", error));
}
async function showManualPurchase(ctx: Context, title: string) {
  await ctx.reply(`<b>🛒 Покупка: ${title}</b>\n\nНапиши менеджеру @manager_mcaura и укажи:\n\n• свой игровой ник\n• товар, который хочешь купить\n\n<i>Менеджер ответит и поможет оформить покупку.</i>`, { parse_mode: "HTML", ...backKeyboard() });
}

bot.start((ctx) => showHome(ctx));
bot.command("menu", (ctx) => showHome(ctx));
bot.command("manager", async (ctx) => {
  if (ctx.from?.username?.toLowerCase() !== managerUsername) return ctx.reply("Эта команда доступна только менеджеру Aura.");
  await setManagerChatId(ctx.chat.id);
  await ctx.reply("<b>✅ Аккаунт менеджера подключён.</b>\nТеперь идеи, баги и жалобы из бота будут приходить сюда.", { parse_mode: "HTML" });
});
bot.action("home", async (ctx) => { pending.delete(ctx.from.id); await safeAnswer(ctx); await showHome(ctx); });
bot.action("shop", showShop);
bot.action("help", showHelp);
bot.action("server", async (ctx) => {
  await safeAnswer(ctx);
  await ctx.reply("<b>🎮 Об Aura</b>\n\n🔴 Aura — гриф-выживание для компьютеров и телефонов.\n🧩 Поддерживаемые версии: <b>1.16.5–26.2</b>.\n\n📢 Новости сервера: @aura_grief\n👤 Создатель: @next_auramc\n💬 Discord сервер: https://discord.gg/JP6jSt7DA", { parse_mode: "HTML", ...Markup.inlineKeyboard([[Markup.button.url("💬 Открыть Discord", links.discord)], [Markup.button.url("📢 Канал сервера", links.telegram), Markup.button.url("👤 Создатель", "https://t.me/next_auramc")], [Markup.button.callback("← В меню", "home")]]) });
});
bot.action("rules", async (ctx) => {
  await safeAnswer(ctx);
  await ctx.reply("<b>📜 Правила Aura</b>\n\n• Уважай игроков: без оскорблений, флуда, капса и рекламы.\n• Читы, X-Ray, Baritone, боты и обход наказаний запрещены.\n• Нельзя использовать баги, дюпы, торговать предметами за реальные деньги или отправлять ложные жалобы.\n• Нельзя передавать аккаунты и привилегии.\n• Правила одинаковы для всех, включая игроков с донатом.\n\n<i>Полная актуальная редакция находится на сайте.</i>", { parse_mode: "HTML", ...Markup.inlineKeyboard([[Markup.button.url("📖 Открыть полные правила", `${links.site}/rules.html`)], [Markup.button.callback("← В меню", "home")]]) });
});
bot.action("applications", async (ctx) => {
  await safeAnswer(ctx);
  await ctx.reply("<b>📋 Заявки в команду Aura</b>\n\nЗаявки не заполняются в боте. Перейди на Discord-сервер Aura и выбери нужную форму:\n\n• Медиа-команда — YouTube или TikTok\n• Другие открытые роли\n\nТам же можно следить за статусом заявки.", { parse_mode: "HTML", ...Markup.inlineKeyboard([[Markup.button.url("Открыть Discord Aura", links.discord)], [Markup.button.callback("← В меню", "home")]]) });
});
bot.action(/^category:(privilege|case|service)$/, (ctx) => showCategory(ctx, ctx.match[1] as ProductCategory));
bot.action(/^product:(.+)$/, async (ctx) => { const product = productById(ctx.match[1]); if (product) await showProduct(ctx, product); else await safeAnswer(ctx, "Товар не найден"); });
bot.action("aura:custom", async (ctx) => {
  await safeAnswer(ctx);
  await ctx.reply("<b>🔴 Пополнение Ауры</b>\n<i>🔥 Акция: 1 ₽ = 1,5 Ауры</i>\n\nДля покупки напиши менеджеру @manager_mcaura:\n\n• свой игровой ник\n• сколько Ауры хочешь купить\n\n<i>Менеджер поможет оформить покупку.</i>", { parse_mode: "HTML", ...backKeyboard() });
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
  await safeAnswer(ctx);
  await showManualPurchase(ctx, product.title);
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
});

bot.catch((error) => console.error("Bot error", error));
async function launchWithRetry() {
  for (;;) {
    try {
      await bot.launch();
      console.log("Aura bot is running");
      return;
    } catch (error) {
      // A second old process or a short Telegram outage must not terminate the app.
      console.error("Unable to start Aura bot; retrying in 5 seconds", error);
      await new Promise((resolve) => setTimeout(resolve, 5_000));
    }
  }
}
void launchWithRetry();

// Amvera checks that an application keeps its assigned HTTP port open.
// The bot itself uses Telegram long polling; this endpoint only reports liveness.
const healthPort = Number(process.env.PORT || 80);
createServer((_request, response) => {
  response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify({ status: "ok", service: "aura-telegram-bot" }));
}).listen(healthPort, "0.0.0.0", () => console.log(`Health check listening on ${healthPort}`));

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
