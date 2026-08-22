import "dotenv/config";
import { randomUUID } from "node:crypto";
import { setDefaultResultOrder } from "node:dns";
import { createServer } from "node:http";
import { join } from "node:path";
import { Telegraf, Markup, Input, type Context } from "telegraf";
import { productById, productsBy, type Product, type ProductCategory } from "./catalog.js";
import {
  getManagerChatId,
  getPendingTelegramLinks,
  removePendingTelegramLink,
  saveOrder,
  savePendingTelegramLink,
  saveTicket,
  setManagerChatId,
  type TicketKind
} from "./store.js";

// Some cloud networks publish an unreachable IPv6 route for Telegram. Prefer
// IPv4 so polling starts reliably after every deployment.
setDefaultResultOrder("ipv4first");

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
type Pending =
  | { type: "ticket"; kind: TicketKind }
  | { type: "order"; productId: string; periodId?: "30" | "90" | "forever" }
  | { type: "aura-amount" }
  | { type: "aura-nick"; amountRub: number };
type TelegramLinkPending = { type: "telegram-link"; nickname?: string };
const pending = new Map<number, Pending>();
const telegramLinkPending = new Map<number, TelegramLinkPending>();
const linkedMinecraftAccounts = new Map<number, string>();
const telegramTwoFactorEnabled = new Map<number, boolean>();
type DonationInfo = { title?: string; expiresAt?: string; remainingDays?: number; permanent?: boolean };
const telegramDonationInfo = new Map<number, DonationInfo>();
const shownTelegramLoginRequests = new Map<number, string>();
// The current Minecraft bridge is configured explicitly. Do not silently fall
// back to an old host or reuse credentials from another integration.
const telegramBridge = process.env.AURA_TELEGRAM_API_URL;
const telegramBridgeSecret = process.env.AURA_TELEGRAM_SECRET || "";
const telegramBridgeReady = Boolean(telegramBridge && telegramBridgeSecret);

type TelegramLoginRequest = {
  telegramId: number;
  requestId: string;
  nickname: string;
  ip: string;
  requestedAt: number;
};
type TelegramAccountEvent = {
  id: string;
  telegramId: number;
  nickname: string;
  type: "logout";
  ip: string;
  createdAt: number;
};

const html = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const dateTime = (timestamp: number) => new Intl.DateTimeFormat("ru-RU", {
  timeZone: "Europe/Moscow",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit"
}).format(new Date(timestamp)) + " МСК";

const mainKeyboard = (telegramId?: number) => Markup.inlineKeyboard([
  [Markup.button.callback("🛒 Магазин AURA", "shop"), Markup.button.callback("🧭 Обращения", "help")],
  [Markup.button.callback("🎮 О сервере", "server"), Markup.button.callback("📜 Правила", "rules")],
  [Markup.button.callback("📋 Заявки в команду", "applications"), Markup.button.url("💬 Discord", links.discord)],
  [Markup.button.url("📢 Канал сервера", links.telegram), Markup.button.url("👤 Канал создателя", "https://t.me/next_auramc")],
  [linkedMinecraftAccounts.has(telegramId || 0)
    ? Markup.button.callback("👤 Профиль", "profile")
    : Markup.button.callback("🔗 Привязать аккаунт", "profile:link")]
]);
const backKeyboard = () => Markup.inlineKeyboard([[Markup.button.callback("← В главное меню", "home")]]);
const safeAnswer = (ctx: Context, text?: string) => ctx.answerCbQuery(text).catch(() => undefined);
const withoutLinkPreview = { link_preview_options: { is_disabled: true } };
const displayName = (ctx: Context) => [ctx.from?.first_name, ctx.from?.last_name].filter(Boolean).join(" ") || "Игрок";
const userData = (ctx: Context) => ({ id: ctx.from!.id, username: ctx.from?.username, name: displayName(ctx) });
const money = (value: number) => new Intl.NumberFormat("ru-RU").format(value) + " ₽";
const escapeHtml = (value: string) => value.replace(/[&<>\"]/g, (symbol) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[symbol] || symbol));

function donationInfoFromStatus(status: Record<string, unknown>): DonationInfo {
  const title = [status.donationTitle, status.donationName, status.rank, status.group]
    .find((value): value is string => typeof value === "string" && value.trim().length > 0);
  const expiresAt = typeof status.donationExpiresAt === "string" ? status.donationExpiresAt : undefined;
  const remainingDays = typeof status.donationRemainingDays === "number" && Number.isFinite(status.donationRemainingDays)
    ? Math.max(0, Math.ceil(status.donationRemainingDays))
    : undefined;
  return { title, expiresAt, remainingDays, permanent: status.donationPermanent === true };
}

function donationProfileText(info?: DonationInfo) {
  if (!info?.title) return "Донат: <i>нет активной привилегии</i>";
  let expiry = "";
  if (info.permanent) expiry = " (навсегда)";
  else if (info.remainingDays !== undefined) expiry = ` (осталось ${info.remainingDays} дн.)`;
  else if (info.expiresAt) {
    const date = new Date(info.expiresAt);
    expiry = Number.isNaN(date.getTime()) ? "" : ` (до ${date.toLocaleDateString("ru-RU")})`;
  }
  return `Донат: <b>${escapeHtml(info.title)}</b>${expiry}`;
}

async function telegramApi(path: string, data: Record<string, string>) {
  if (!telegramBridgeReady) return { ok: false, code: "bridge_not_configured" } as Record<string, unknown>;
  const response = await fetch(`${telegramBridge}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Aura-Secret": telegramBridgeSecret },
    body: JSON.stringify(data),
    signal: AbortSignal.timeout(8_000)
  });
  const body = await response.text();
  try {
    return JSON.parse(body) as Record<string, unknown>;
  } catch {
    return { ok: false, code: `http_${response.status}` } as Record<string, unknown>;
  }
}

async function refreshTelegramLink(telegramId: number) {
  try {
    const status = await telegramApi("/telegram/account/status", { telegramId: String(telegramId) });
    if (status.linked === true && typeof status.nickname === "string") {
      linkedMinecraftAccounts.set(telegramId, status.nickname);
      telegramTwoFactorEnabled.set(telegramId, status.twoFactorEnabled !== false);
      telegramDonationInfo.set(telegramId, donationInfoFromStatus(status));
    } else {
      linkedMinecraftAccounts.delete(telegramId);
      telegramTwoFactorEnabled.delete(telegramId);
      telegramDonationInfo.delete(telegramId);
    }
  } catch {
    linkedMinecraftAccounts.delete(telegramId);
    telegramTwoFactorEnabled.delete(telegramId);
    telegramDonationInfo.delete(telegramId);
  }
}

async function showProfile(ctx: Context, answerCallback = false) {
  if (answerCallback) await safeAnswer(ctx);
  if (!ctx.from?.id) return;
  await refreshTelegramLink(ctx.from.id);
  const nickname = linkedMinecraftAccounts.get(ctx.from.id);
  if (!nickname) {
    return ctx.reply("<b>👤 Профиль AURA</b>\n\nИгровой аккаунт пока не привязан.", {
      parse_mode: "HTML",
      ...Markup.inlineKeyboard([
        [Markup.button.callback("🔗 Привязать аккаунт", "profile:link")],
        [Markup.button.callback("← В меню", "home")]
      ])
    });
  }
  const twoFactorEnabled = telegramTwoFactorEnabled.get(ctx.from.id) !== false;
  const twoFactorButton = twoFactorEnabled
    ? Markup.button.callback("🛡 Отключить 2FA", "profile:2fa-off")
    : Markup.button.callback("🛡 Включить 2FA", "profile:2fa-on");
  return ctx.reply(
    `<b>👤 Профиль AURA</b>\n\nИгровой аккаунт: <b>${escapeHtml(nickname)}</b>\n${donationProfileText(telegramDonationInfo.get(ctx.from.id))}\nДвухфакторная защита: ${twoFactorEnabled ? "<b>включена</b> ✅" : "<b>отключена</b> ❌"}`,
    { parse_mode: "HTML", ...Markup.inlineKeyboard([
      [Markup.button.callback("🚪 Кикнуть", "profile:kick"), Markup.button.callback("🔑 Восстановить пароль", "profile:reset")],
      [twoFactorButton],
      [Markup.button.callback("🔓 Отвязать аккаунт", "profile:unlink")],
      [Markup.button.callback("← В меню", "home")]
    ]) }
  );
}

async function showHome(ctx: Context) {
  if (ctx.from?.id) await refreshTelegramLink(ctx.from.id);
  const text = "<b>🔴 AURA – ГРИФЕРСКИЙ СЕРВЕР</b>\n<i>🔥 Играй, сражайся, забирай своё.</i>\n\n🎮 <b>Для телефонов и компьютеров</b>\nВерсии: <b>1.16.5–26.2</b>\nРежим: <b>гриф-выживание</b>\n\n📢 Канал сервера: @aura_grief\n💬 Discord сервер: <a href=\"https://discord.gg/JP6jSt7DA\">discord.gg/JP6jSt7DA</a>\n👤 Канал создателя: @next_auramc\n\n<i>Выбирай раздел ниже – всё нужное в одном боте.</i>";
  return ctx.replyWithPhoto(Input.fromLocalFile(asset("aura-home.png")), { caption: text, parse_mode: "HTML", ...withoutLinkPreview, ...mainKeyboard(ctx.from?.id) });
}

async function showShop(ctx: Context) {
  await safeAnswer(ctx);
  return ctx.reply("<b>🛒 Магазин AURA</b>\n<i>Привилегии, кейсы, услуги и Аура — с выдачей на игровой аккаунт.</i>\n\nВыбери нужный раздел. После оформления заказа менеджер пришлёт способ оплаты.", {
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
  const rows = productsBy(category).map((product) => {
    const price = product.periods?.[0] ? `от ${money(product.periods[0].price)}` : money(product.price);
    return [Markup.button.callback(`${product.emoji} ${product.title} · ${price}`, `product:${product.id}`)];
  });
  rows.push([Markup.button.callback("← К категориям", "shop")]);
  return ctx.reply(`<b>${categoryTitle(category)}</b>\n<i>Актуальные цены с сайта AURA.</i>\n\nНажми на товар, чтобы посмотреть состав и оформить заказ прямо в Telegram.`, { parse_mode: "HTML", ...Markup.inlineKeyboard(rows) });
}
async function showProduct(ctx: Context, product: Product) {
  await safeAnswer(ctx);
  const perks = product.perks.map((perk) => `• ${perk}`).join("\n");
  const periodText = product.periods
    ? `<b>Выбери срок:</b>\n${product.periods.map((period) => `• ${period.title} — <b>${money(period.price)}</b>`).join("\n")}`
    : `<b>Цена:</b> ${money(product.price)}`;
  const buyRows = product.periods
    ? [
        product.periods.slice(0, 2).map((period) => Markup.button.callback(`${period.title} · ${money(period.price)}`, `buy:${product.id}:${period.id}`)),
        [Markup.button.callback(`Навсегда · ${money(product.periods[2].price)}`, `buy:${product.id}:forever`)]
      ]
    : [[Markup.button.callback(`🛒 Оформить заказ · ${money(product.price)}`, `buy:${product.id}`)]];
  return ctx.replyWithPhoto(Input.fromLocalFile(asset(product.image)), { caption: `<b>${product.emoji} ${product.title}</b>\n${product.description}\n\n${perks}\n\n${periodText}\n\nПосле оформления менеджер пришлёт способ оплаты и выдаст товар на игровой аккаунт.`,
    parse_mode: "HTML",
    ...Markup.inlineKeyboard([
      ...buyRows,
      [Markup.button.callback("← К списку", `category:${product.category}`)]
    ])
  });
}
async function showHelp(ctx: Context) {
  await safeAnswer(ctx);
  return ctx.reply("<b>🧭 Обращения</b>\n\nКоманда AURA читает каждое обращение. За полезную идею или подтверждённый баг можно получить награду. Для жалобы прикладывай ник, описание и, если есть, доказательства.", {
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

// Confirm callback buttons before any potentially slow menu or API work.
// Telegram otherwise may show a misleading "action is no longer available" toast.
bot.use(async (ctx, next) => {
  if (ctx.callbackQuery) {
    await ctx.answerCbQuery().catch(() => undefined);
  }
  return next();
});

bot.start((ctx) => showHome(ctx));
bot.command("menu", (ctx) => showHome(ctx));
bot.command("manager", async (ctx) => {
  if (ctx.from?.username?.toLowerCase() !== managerUsername) return ctx.reply("Эта команда доступна только менеджеру AURA.");
  await setManagerChatId(ctx.chat.id);
  await ctx.reply("<b>✅ Аккаунт менеджера подключён.</b>\nТеперь идеи, баги и жалобы из бота AURA будут приходить сюда.", { parse_mode: "HTML" });
});
bot.action("home", async (ctx) => { pending.delete(ctx.from.id); await safeAnswer(ctx); await showHome(ctx); });
bot.action("shop", showShop);
bot.action("help", showHelp);
bot.action("profile", async (ctx) => {
  await showProfile(ctx, true);
});
bot.action("profile:link", async (ctx) => {
  await safeAnswer(ctx);
  telegramLinkPending.set(ctx.from.id, { type: "telegram-link" });
  await ctx.reply("<b>🔗 Привязка аккаунта AURA</b>\n\nОтправь свой игровой ник Minecraft.\n\n<i>Перед этим зайди на сервер AURA, напиши <code>/link</code> и выбери Telegram.</i>", { parse_mode: "HTML" });
});
bot.action("profile:unlink", async (ctx) => {
  const result = await telegramApi("/telegram/action", { telegramId: String(ctx.from.id), action: "unlink" });
  if (result.ok !== true) return safeAnswer(ctx, "Аккаунт ещё не привязан");
  linkedMinecraftAccounts.delete(ctx.from.id);
  telegramTwoFactorEnabled.delete(ctx.from.id);
  telegramDonationInfo.delete(ctx.from.id);
  await safeAnswer(ctx, "Аккаунт отвязан");
  await ctx.reply("✅ Игровой аккаунт отвязан от Telegram.", mainKeyboard(ctx.from.id));
});
bot.action(/^(profile:kick|profile:reset|profile:2fa-off|profile:2fa-on)$/, async (ctx) => {
  const actions: Record<string, string> = {
    "profile:kick": "kick",
    "profile:reset": "reset_password",
    "profile:2fa-off": "two_factor_off",
    "profile:2fa-on": "two_factor_on"
  };
  const result = await telegramApi("/telegram/action", { telegramId: String(ctx.from.id), action: actions[ctx.match[1]] });
  if (result.ok !== true) return safeAnswer(ctx, "Сначала привяжи аккаунт");
  await safeAnswer(ctx, "Готово");
  const profileBack = Markup.inlineKeyboard([[Markup.button.callback("← Вернуться в профиль", "profile")]]);
  if (ctx.match[1] === "profile:reset") {
    return ctx.reply(`🔑 <b>Пароль восстановлен.</b>\n\nНовый пароль: <code>${String(result.password || "")}</code>\n\nСохрани его. Старый пароль больше не работает.`, { parse_mode: "HTML", ...profileBack });
  }
  if (ctx.match[1] === "profile:2fa-off") {
    telegramTwoFactorEnabled.set(ctx.from.id, false);
    return ctx.reply("🛡 Двухфакторная авторизация отключена. Подтверждение входа через Telegram больше запрашиваться не будет.", profileBack);
  }
  if (ctx.match[1] === "profile:2fa-on") {
    telegramTwoFactorEnabled.set(ctx.from.id, true);
    return ctx.reply("🛡 Двухфакторная авторизация включена. После длительного отсутствия вход потребуется подтвердить через Telegram.", profileBack);
  }
  await ctx.reply("🚪 Команда выполнена: игровой аккаунт отключён от сервера.", profileBack);
});
bot.action(/^login:(approve|allow|deny)(?::([0-9a-f-]{36}))?$/, async (ctx) => {
  const allow = ctx.match[1] !== "deny";
  const requestId = ctx.match[2];
  const answer: Record<string, string> = {
    telegramId: String(ctx.from.id),
    allow: String(allow)
  };
  if (requestId) answer.requestId = requestId;
  const result = await telegramApi("/telegram/login/answer", answer);
  shownTelegramLoginRequests.delete(ctx.from.id);
  if (result.ok !== true) return safeAnswer(ctx, "Запрос уже истёк");
  await safeAnswer(ctx, allow ? "Вход подтверждён" : "Вход отклонён");
  await ctx.editMessageText(
    allow
      ? `<b>✅ Вход в аккаунт Aura подтверждён</b>\n\nВремя: <code>${dateTime(Date.now())}</code>\nИгрок допущен на сервер.`
      : `<b>❌ Вход в аккаунт Aura отклонён</b>\n\nВремя: <code>${dateTime(Date.now())}</code>\nПодключение к серверу отменено.`,
    { parse_mode: "HTML" }
  ).catch(() => undefined);
});
bot.action("server", async (ctx) => {
  await safeAnswer(ctx);
  await ctx.reply("<b>🎮 Об AURA</b>\n\n🔴 AURA – гриф-выживание для компьютеров и телефонов.\n🧩 Поддерживаемые версии: <b>1.16.5–26.2</b>.\n\n📢 Новости сервера: @aura_grief\n👤 Создатель: @next_auramc\n💬 Discord сервер: https://discord.gg/JP6jSt7DA", { parse_mode: "HTML", ...withoutLinkPreview, ...Markup.inlineKeyboard([[Markup.button.url("💬 Открыть Discord", links.discord)], [Markup.button.url("📢 Канал сервера", links.telegram), Markup.button.url("👤 Создатель", "https://t.me/next_auramc")], [Markup.button.callback("← В меню", "home")]]) });
});
bot.action("rules", async (ctx) => {
  await safeAnswer(ctx);
  await ctx.reply("<b>📜 Правила AURA</b>\n\n• Уважай игроков: без оскорблений, флуда, капса и рекламы.\n• Читы, X-Ray, Baritone, боты и обход наказаний запрещены.\n• Нельзя использовать баги, дюпы, торговать предметами за реальные деньги или отправлять ложные жалобы.\n• Нельзя передавать аккаунты и привилегии.\n• Правила одинаковы для всех, включая игроков с донатом.\n\n<i>Полная актуальная редакция находится на сайте.</i>", { parse_mode: "HTML", ...Markup.inlineKeyboard([[Markup.button.url("📖 Открыть полные правила", `${links.site}/rules.html`)], [Markup.button.callback("← В меню", "home")]]) });
});
bot.action("applications", async (ctx) => {
  await safeAnswer(ctx);
  pending.set(ctx.from.id, { type: "ticket", kind: "application" });
  await ctx.reply("<b>📋 Заявка в команду AURA</b>\n\nНапиши одним сообщением:\n• желаемую роль;\n• игровой ник;\n• возраст;\n• опыт и ссылки на работы, если они есть.\n\n<i>Чтобы отменить — /cancel</i>", { parse_mode: "HTML", ...Markup.inlineKeyboard([[Markup.button.url("Discord AURA", links.discord)], [Markup.button.callback("← В меню", "home")]]) });
});
bot.action(/^category:(privilege|case|service)$/, (ctx) => showCategory(ctx, ctx.match[1] as ProductCategory));
bot.action(/^product:(.+)$/, async (ctx) => { const product = productById(ctx.match[1]); if (product) await showProduct(ctx, product); else await safeAnswer(ctx, "Товар не найден"); });
bot.action("aura:custom", async (ctx) => {
  await safeAnswer(ctx);
  pending.set(ctx.from.id, { type: "aura-amount" });
  await ctx.reply("<b>🔴 Пополнение Ауры</b>\n\nКурс: <b>1 ₽ = 1,5 Ауры</b>.\nМинимум — 5 ₽, максимум — 5 000 ₽.\n\nОтправь сумму пополнения в рублях.\n\n<i>Чтобы отменить — /cancel</i>", { parse_mode: "HTML", ...backKeyboard() });
});
bot.action(/^ticket:(idea|bug|report)$/, async (ctx) => {
  const kind = ctx.match[1] as TicketKind;
  pending.set(ctx.from.id, { type: "ticket", kind });
  await safeAnswer(ctx);
  const prompts: Record<TicketKind, string> = {
    idea: "💡 <b>Предложение по улучшению</b>\n\nОпиши идею: какую проблему она решает, как должна работать и почему это будет полезно игрокам.",
    bug: "🐞 <b>Сообщение о баге</b>\n\nНапиши, где найден баг, как его повторить и что произошло. Если есть видео или скрин, приложи ссылку прямо в описание.",
    report: "🚨 <b>Жалоба на игрока</b>\n\nУкажи ник игрока, нарушение, время и серверный режим. Добавь ссылку на видео или скриншоты, если они есть.",
    application: "📋 <b>Заявка в команду AURA</b>\n\nНапиши желаемую роль, игровой ник, возраст, опыт и ссылки на работы, если они есть."
  };
  await ctx.reply(prompts[kind] + "\n\n<i>Чтобы отменить – /cancel</i>", { parse_mode: "HTML", ...backKeyboard() });
});
bot.action(/^buy:([^:]+)(?::(30|90|forever))?$/, async (ctx) => {
  const product = productById(ctx.match[1]);
  if (!product) return safeAnswer(ctx, "Товар не найден");
  const periodId = ctx.match[2] as "30" | "90" | "forever" | undefined;
  const period = periodId ? product.periods?.find((item) => item.id === periodId) : undefined;
  if (product.periods && !period) return safeAnswer(ctx, "Выбери срок привилегии ещё раз");
  await safeAnswer(ctx);
  pending.set(ctx.from.id, { type: "order", productId: product.id, periodId });
  const title = period ? `${product.title} · ${period.title}` : product.title;
  const amount = period?.price ?? product.price;
  await ctx.reply(`<b>🛒 Оформление заказа: ${title}</b>\nСтоимость: <b>${money(amount)}</b>\n\nОтправь игровой ник, на который нужно выдать товар. После этого заказ уйдёт менеджеру для оплаты и выдачи.`, { parse_mode: "HTML", ...backKeyboard() });
});
bot.command("cancel", async (ctx) => { pending.delete(ctx.from.id); await ctx.reply("Действие отменено.", mainKeyboard()); });

bot.on("text", async (ctx) => {
  const state = pending.get(ctx.from.id);
  if (ctx.message.text.startsWith("/")) return;
  const linkState = telegramLinkPending.get(ctx.from.id);
  if (linkState) {
    const nickname = ctx.message.text.trim();
    if (!/^[A-Za-z0-9_]{3,16}$/.test(nickname)) return ctx.reply("Ник Minecraft должен состоять из 3–16 латинских букв, цифр или символа _. Попробуй ещё раз.");
    if (!telegramBridgeReady) return ctx.reply("Привязка к текущему серверу ещё настраивается. Попробуй чуть позже.");
    try {
      const response = await fetch(`${telegramBridge}/telegram/link/request`, { method: "POST", headers: { "Content-Type": "application/json", "X-Aura-Secret": telegramBridgeSecret }, body: JSON.stringify({ telegramId: String(ctx.from.id), nickname }) });
      const result = await response.json() as { ok?: boolean; code?: string };
      if (!result.ok) return ctx.reply(result.code === "open_link_in_game" ? "Сначала зайди в Minecraft, напиши <code>/link</code>, выбери Telegram и повтори попытку." : "Не удалось начать привязку. Проверь ник и попробуй ещё раз.", { parse_mode: "HTML" });
      telegramLinkPending.set(ctx.from.id, { type: "telegram-link", nickname });
      await savePendingTelegramLink(ctx.from.id, nickname);
      return ctx.reply(`<b>Запрос отправлен.</b>\n\nВ Minecraft на аккаунте <b>${nickname}</b> появится кнопка подтверждения. Нажми её — после этого бот сообщит об успешной привязке.`, { parse_mode: "HTML" });
    } catch {
      return ctx.reply("Сервер привязки пока недоступен. Попробуй чуть позже.");
    }
  }
  if (!state) return;
  if (state.type === "aura-amount") {
    const amountRub = Number(ctx.message.text.trim().replace(",", "."));
    if (!Number.isInteger(amountRub) || amountRub < 5 || amountRub > 5000) {
      return ctx.reply("Введи целую сумму от 5 до 5 000 ₽.");
    }
    const auraAmount = Math.round(amountRub * 1.5);
    pending.set(ctx.from.id, { type: "aura-nick", amountRub });
    return ctx.reply(`<b>Будет начислено: ${auraAmount} Ауры.</b>\n\nТеперь отправь игровой ник для выдачи.`, { parse_mode: "HTML", ...backKeyboard() });
  }
  if (state.type === "aura-nick") {
    const minecraftNick = ctx.message.text.trim();
    if (!/^[A-Za-z0-9_]{3,16}$/.test(minecraftNick)) return ctx.reply("Ник Minecraft должен состоять из 3–16 латинских букв, цифр или символа _. Попробуй ещё раз.");
    const auraAmount = Math.round(state.amountRub * 1.5);
    const order = {
      id: randomUUID().slice(0, 8).toUpperCase(),
      productId: "aura-topup",
      productTitle: `Пополнение Ауры · ${auraAmount} Ауры`,
      amountRub: state.amountRub,
      auraAmount,
      minecraftNick,
      createdAt: new Date().toISOString(),
      user: userData(ctx)
    };
    await saveOrder(order);
    pending.delete(ctx.from.id);
    await sendStaff(`<b>🔴 ЗАКАЗ #${order.id}</b>\nТовар: <b>${order.productTitle}</b> · <b>${money(order.amountRub)}</b>\nНик: <code>${minecraftNick}</code>\nПокупатель: ${order.user.name}${order.user.username ? ` (@${order.user.username})` : ""} · <code>${order.user.id}</code>`);
    return ctx.reply(`<b>✅ Заказ #${order.id} создан.</b>\n\nМенеджер пришлёт способ оплаты. После оплаты <b>${auraAmount} Ауры</b> будут начислены на ник <b>${minecraftNick}</b>.`, { parse_mode: "HTML", ...mainKeyboard(ctx.from.id) });
  }
  if (state.type === "order") {
    const product = productById(state.productId);
    const minecraftNick = ctx.message.text.trim();
    if (!product) { pending.delete(ctx.from.id); return ctx.reply("Товар больше недоступен. Открой магазин заново.", mainKeyboard(ctx.from.id)); }
    if (!/^[A-Za-z0-9_]{3,16}$/.test(minecraftNick)) return ctx.reply("Ник Minecraft должен состоять из 3–16 латинских букв, цифр или символа _. Попробуй ещё раз.");
    const period = state.periodId ? product.periods?.find((item) => item.id === state.periodId) : undefined;
    if (product.periods && !period) { pending.delete(ctx.from.id); return ctx.reply("Срок привилегии не найден. Открой товар заново.", mainKeyboard(ctx.from.id)); }
    const productTitle = period ? `${product.title} · ${period.title}` : product.title;
    const amountRub = period?.price ?? product.price;
    const order = { id: randomUUID().slice(0, 8).toUpperCase(), productId: product.id, productTitle, amountRub, minecraftNick, createdAt: new Date().toISOString(), user: userData(ctx) };
    await saveOrder(order);
    pending.delete(ctx.from.id);
    await sendStaff(`<b>🛒 ЗАКАЗ #${order.id}</b>\nТовар: <b>${order.productTitle}</b> · <b>${money(order.amountRub)}</b>\nНик: <code>${minecraftNick}</code>\nПокупатель: ${order.user.name}${order.user.username ? ` (@${order.user.username})` : ""} · <code>${order.user.id}</code>`);
    return ctx.reply(`<b>✅ Заказ #${order.id} создан.</b>\n\nМенеджер проверит его и пришлёт способ оплаты. Товар будет выдан на ник <b>${minecraftNick}</b>.`, { parse_mode: "HTML", ...mainKeyboard(ctx.from.id) });
  }
  if (state.type === "ticket") {
    const text = ctx.message.text.trim();
    if (text.length < 15) return ctx.reply("Опиши обращение подробнее – хотя бы 15 символов.");
    const ticket = { id: randomUUID().slice(0, 8).toUpperCase(), kind: state.kind, text, createdAt: new Date().toISOString(), user: userData(ctx) };
    await saveTicket(ticket);
    pending.delete(ctx.from.id);
    const labels: Record<TicketKind, string> = { idea: "💡 ИДЕЯ", bug: "🐞 БАГ", report: "🚨 ЖАЛОБА", application: "📋 ЗАЯВКА В КОМАНДУ" };
    await sendStaff(`<b>${labels[state.kind]} #${ticket.id}</b>\nОт: ${ticket.user.name}${ticket.user.username ? ` (@${ticket.user.username})` : ""} · <code>${ticket.user.id}</code>\n\n${text}`);
    return ctx.reply("<b>Готово – обращение отправлено команде AURA.</b>\nЕсли идею реализуют или баг подтвердится, с тобой свяжутся насчёт награды.", { parse_mode: "HTML", ...mainKeyboard() });
  }
});

let pollingTelegramLinks = false;
async function restorePendingTelegramLinks() {
  for (const request of await getPendingTelegramLinks()) {
    telegramLinkPending.set(request.telegramId, { type: "telegram-link", nickname: request.nickname });
  }
}

async function isTelegramAccountLinked(telegramId: number, nickname: string) {
  const account = await telegramApi("/telegram/account/status", { telegramId: String(telegramId) });
  return account.linked === true
    && typeof account.nickname === "string"
    && account.nickname.toLowerCase() === nickname.toLowerCase();
}

async function notifyTelegramLinkSuccess(telegramId: number, nickname: string) {
  linkedMinecraftAccounts.set(telegramId, nickname);
  telegramTwoFactorEnabled.set(telegramId, true);
  await bot.telegram.sendMessage(
    telegramId,
    `✅ <b>Привязка завершена!</b>\n\nMinecraft-аккаунт <b>${nickname}</b> успешно привязан к Telegram. Теперь управление аккаунтом доступно в разделе «Профиль».`,
    {
      parse_mode: "HTML",
      ...Markup.inlineKeyboard([
        [Markup.button.callback("👤 Открыть профиль", "profile")],
        [Markup.button.callback("← В главное меню", "home")]
      ])
    }
  );
  telegramLinkPending.delete(telegramId);
  await removePendingTelegramLink(telegramId);
}

async function pollTelegramLinkConfirmations() {
  if (!telegramBridgeSecret || pollingTelegramLinks) return;
  pollingTelegramLinks = true;
  try {
    for (const [telegramId, request] of telegramLinkPending) {
      if (!request.nickname) continue;
      try {
        if (await isTelegramAccountLinked(telegramId, request.nickname)) {
          await notifyTelegramLinkSuccess(telegramId, request.nickname);
          continue;
        }
        const statusResponse = await fetch(`${telegramBridge}/telegram/link/status`, { method: "POST", headers: { "Content-Type": "application/json", "X-Aura-Secret": telegramBridgeSecret }, body: JSON.stringify({ telegramId: String(telegramId), nickname: request.nickname }) });
        const status = await statusResponse.json() as { confirmed?: boolean };
        if (!status.confirmed) continue;
        const finishResponse = await fetch(`${telegramBridge}/telegram/link/finish`, { method: "POST", headers: { "Content-Type": "application/json", "X-Aura-Secret": telegramBridgeSecret }, body: JSON.stringify({ telegramId: String(telegramId), nickname: request.nickname }) });
        const finish = await finishResponse.json() as { ok?: boolean };
        if (!finish.ok && !(await isTelegramAccountLinked(telegramId, request.nickname))) continue;
        await notifyTelegramLinkSuccess(telegramId, request.nickname);
      } catch (error) { console.error("Telegram link status check failed", error); }
    }
  } finally {
    pollingTelegramLinks = false;
  }
}
await restorePendingTelegramLinks();
setInterval(() => void pollTelegramLinkConfirmations(), 2_500);

let pollingTelegramLogins = false;
async function pollTelegramLoginRequests() {
  if (!telegramBridgeSecret || pollingTelegramLogins) return;
  pollingTelegramLogins = true;
  try {
    const result = await telegramApi("/telegram/login/pending", {});
    const requests = (Array.isArray(result.requests) ? result.requests : []) as TelegramLoginRequest[];
    const activeIds = new Set<number>();
    for (const item of requests) {
      if (!item || typeof item !== "object") continue;
      const telegramId = Number(item.telegramId);
      const requestId = String(item.requestId || `legacy-${telegramId}`);
      const nickname = String(item.nickname || "");
      const ip = String(item.ip || "неизвестен");
      const requestedAt = Number(item.requestedAt) || Date.now();
      if (!Number.isSafeInteger(telegramId) || telegramId <= 0 || !nickname) continue;
      activeIds.add(telegramId);
      if (shownTelegramLoginRequests.get(telegramId) === requestId) continue;
      const allowAction = requestId.startsWith("legacy-") ? "login:allow" : `login:allow:${requestId}`;
      const denyAction = requestId.startsWith("legacy-") ? "login:deny" : `login:deny:${requestId}`;
      await bot.telegram.sendMessage(telegramId,
        `<b>🔐 Вход в аккаунт Aura</b>\n\n` +
        `Игрок: <code>${html(nickname)}</code>\n` +
        `IP-адрес: <code>${html(ip)}</code>\n` +
        `Время: <code>${dateTime(requestedAt)}</code>\n\n` +
        `Подтвердите вход, только если это вы. Если запрос вам незнаком, отклоните его.`, {
          parse_mode: "HTML",
          ...Markup.inlineKeyboard([[
            Markup.button.callback("✅ Подтвердить", allowAction),
            Markup.button.callback("❌ Отклонить", denyAction)
          ]])
        });
      shownTelegramLoginRequests.set(telegramId, requestId);
    }
    for (const telegramId of shownTelegramLoginRequests.keys()) {
      if (!activeIds.has(telegramId)) shownTelegramLoginRequests.delete(telegramId);
    }

    const eventResult = await telegramApi("/telegram/events/pending", {});
    const events = (Array.isArray(eventResult.events) ? eventResult.events : []) as TelegramAccountEvent[];
    for (const event of events) {
      if (event.type === "logout") {
        await bot.telegram.sendMessage(
          event.telegramId,
          `<b>🚪 Вы вышли с сервера Aura</b>\n\n` +
          `Аккаунт: <code>${html(event.nickname)}</code>\n` +
          `Время выхода: <code>${dateTime(event.createdAt)}</code>\n\n` +
          `Игровая сессия завершена.`,
          { parse_mode: "HTML" }
        );
      }
      await telegramApi("/telegram/events/ack", { eventId: event.id });
    }
  } catch (error) {
    console.error("Telegram account event check failed", error);
  } finally {
    pollingTelegramLogins = false;
  }
}
setInterval(() => void pollTelegramLoginRequests(), 2_500);

bot.catch((error) => console.error("Bot error", error));
async function launchWithRetry() {
  for (;;) {
    try {
      await bot.launch();
      console.log("AURA bot is running");
      return;
    } catch (error) {
      // A second old process or a short Telegram outage must not terminate the app.
      console.error("Unable to start AURA bot; retrying in 5 seconds", error);
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
