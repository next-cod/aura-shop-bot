import "dotenv/config";
import { randomUUID } from "node:crypto";
import { setDefaultResultOrder } from "node:dns";
import { createServer } from "node:http";
import { join } from "node:path";
import { Telegraf, Markup, Input, type Context } from "telegraf";
import { productById, productsBy, type Product, type ProductCategory } from "./catalog.js";
import { getManagerChatId, saveTicket, setManagerChatId, type TicketKind } from "./store.js";

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
type Pending = { type: "ticket"; kind: TicketKind };
type TelegramLinkPending = { type: "telegram-link"; nickname?: string };
const pending = new Map<number, Pending>();
const telegramLinkPending = new Map<number, TelegramLinkPending>();
const linkedMinecraftAccounts = new Map<number, string>();
const telegramTwoFactorEnabled = new Map<number, boolean>();
const shownTelegramLoginRequests = new Set<number>();
const telegramBridge = process.env.AURA_TELEGRAM_API_URL || "http://213.171.18.146:22243";
// Telegram uses the already configured server bridge secret until it receives
// its own separate variable. This keeps both official bots on the same trusted bridge.
const telegramBridgeSecret = process.env.AURA_TELEGRAM_SECRET || process.env.AURA_VK_SECRET || process.env.AURA_SHARED_SECRET || "";

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

async function telegramApi(path: string, data: Record<string, string>) {
  if (!telegramBridgeSecret) return { ok: false, code: "bridge_not_configured" } as Record<string, unknown>;
  const response = await fetch(`${telegramBridge}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Aura-Secret": telegramBridgeSecret },
    body: JSON.stringify(data)
  });
  return await response.json() as Record<string, unknown>;
}

async function refreshTelegramLink(telegramId: number) {
  try {
    const status = await telegramApi("/telegram/account/status", { telegramId: String(telegramId) });
    if (status.linked === true && typeof status.nickname === "string") {
      linkedMinecraftAccounts.set(telegramId, status.nickname);
      telegramTwoFactorEnabled.set(telegramId, status.twoFactorEnabled !== false);
    } else {
      linkedMinecraftAccounts.delete(telegramId);
      telegramTwoFactorEnabled.delete(telegramId);
    }
  } catch {
    linkedMinecraftAccounts.delete(telegramId);
    telegramTwoFactorEnabled.delete(telegramId);
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
    `<b>👤 Профиль AURA</b>\n\nИгровой аккаунт: <b>${nickname}</b>\nДвухфакторная защита: ${twoFactorEnabled ? "<b>включена</b> ✅" : "<b>отключена</b> ❌"}`,
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
  return ctx.reply("<b>🛒 Магазин AURA</b>\n<i>🔥 Скидка 40% на все позиции</i>\n\nВыбери товар. Для покупки напиши менеджеру – он подскажет дальнейшие шаги.", {
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
bot.action(/^(login:approve|login:deny)$/, async (ctx) => {
  const allow = ctx.match[1] === "login:approve";
  const result = await telegramApi("/telegram/login/answer", {
    telegramId: String(ctx.from.id),
    allow: String(allow)
  });
  shownTelegramLoginRequests.delete(ctx.from.id);
  if (result.ok !== true) return safeAnswer(ctx, "Запрос уже истёк");
  await safeAnswer(ctx, allow ? "Вход подтверждён" : "Вход отклонён");
  await ctx.reply(allow ? "✅ Вход в аккаунт AURA подтверждён." : "⛔ Вход отклонён. Игрок отключён от сервера.");
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
  await ctx.reply("<b>📋 Заявки в команду AURA</b>\n\nЗаявки не заполняются в боте. Перейди на Discord-сервер AURA и выбери нужную форму:\n\n• Медиа-команда – YouTube или TikTok\n• Другие открытые роли\n\nТам же можно следить за статусом заявки.", { parse_mode: "HTML", ...Markup.inlineKeyboard([[Markup.button.url("Открыть Discord AURA", links.discord)], [Markup.button.callback("← В меню", "home")]]) });
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
  await ctx.reply(prompts[kind] + "\n\n<i>Чтобы отменить – /cancel</i>", { parse_mode: "HTML", ...backKeyboard() });
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
  if (ctx.message.text.startsWith("/")) return;
  const linkState = telegramLinkPending.get(ctx.from.id);
  if (linkState) {
    const nickname = ctx.message.text.trim();
    if (!/^[A-Za-z0-9_]{3,16}$/.test(nickname)) return ctx.reply("Ник Minecraft должен состоять из 3–16 латинских букв, цифр или символа _. Попробуй ещё раз.");
    if (!telegramBridgeSecret) return ctx.reply("Привязка временно настраивается. Попробуй чуть позже.");
    try {
      const response = await fetch(`${telegramBridge}/telegram/link/request`, { method: "POST", headers: { "Content-Type": "application/json", "X-Aura-Secret": telegramBridgeSecret }, body: JSON.stringify({ telegramId: String(ctx.from.id), nickname }) });
      const result = await response.json() as { ok?: boolean; code?: string };
      if (!result.ok) return ctx.reply(result.code === "open_link_in_game" ? "Сначала зайди в Minecraft, напиши <code>/link</code>, выбери Telegram и повтори попытку." : "Не удалось начать привязку. Проверь ник и попробуй ещё раз.", { parse_mode: "HTML" });
      telegramLinkPending.set(ctx.from.id, { type: "telegram-link", nickname });
      return ctx.reply(`<b>Запрос отправлен.</b>\n\nВ Minecraft на аккаунте <b>${nickname}</b> появится кнопка подтверждения. Нажми её — после этого бот сообщит об успешной привязке.`, { parse_mode: "HTML" });
    } catch {
      return ctx.reply("Сервер привязки пока недоступен. Попробуй чуть позже.");
    }
  }
  if (!state) return;
  if (state.type === "ticket") {
    const text = ctx.message.text.trim();
    if (text.length < 15) return ctx.reply("Опиши обращение подробнее – хотя бы 15 символов.");
    const ticket = { id: randomUUID().slice(0, 8).toUpperCase(), kind: state.kind, text, createdAt: new Date().toISOString(), user: userData(ctx) };
    await saveTicket(ticket);
    pending.delete(ctx.from.id);
    const labels: Record<TicketKind, string> = { idea: "💡 ИДЕЯ", bug: "🐞 БАГ", report: "🚨 ЖАЛОБА" };
    await sendStaff(`<b>${labels[state.kind]} #${ticket.id}</b>\nОт: ${ticket.user.name}${ticket.user.username ? ` (@${ticket.user.username})` : ""} · <code>${ticket.user.id}</code>\n\n${text}`);
    return ctx.reply("<b>Готово – обращение отправлено команде AURA.</b>\nЕсли идею реализуют или баг подтвердится, с тобой свяжутся насчёт награды.", { parse_mode: "HTML", ...mainKeyboard() });
  }
});

let pollingTelegramLinks = false;
async function pollTelegramLinkConfirmations() {
  if (!telegramBridgeSecret || pollingTelegramLinks) return;
  pollingTelegramLinks = true;
  try {
    for (const [telegramId, request] of telegramLinkPending) {
      if (!request.nickname) continue;
      try {
        const statusResponse = await fetch(`${telegramBridge}/telegram/link/status`, { method: "POST", headers: { "Content-Type": "application/json", "X-Aura-Secret": telegramBridgeSecret }, body: JSON.stringify({ telegramId: String(telegramId), nickname: request.nickname }) });
        const status = await statusResponse.json() as { confirmed?: boolean };
        if (!status.confirmed) continue;
        const finishResponse = await fetch(`${telegramBridge}/telegram/link/finish`, { method: "POST", headers: { "Content-Type": "application/json", "X-Aura-Secret": telegramBridgeSecret }, body: JSON.stringify({ telegramId: String(telegramId), nickname: request.nickname }) });
        const finish = await finishResponse.json() as { ok?: boolean };
        if (!finish.ok) continue;
        linkedMinecraftAccounts.set(telegramId, request.nickname);
        telegramTwoFactorEnabled.set(telegramId, true);
        telegramLinkPending.delete(telegramId);
        await bot.telegram.sendMessage(telegramId, `✅ <b>Аккаунт ${request.nickname} успешно привязан к Telegram.</b>\n\nТеперь в меню доступно управление безопасностью аккаунта.`, { parse_mode: "HTML", ...mainKeyboard(telegramId) });
      } catch (error) { console.error("Telegram link status check failed", error); }
    }
  } finally {
    pollingTelegramLinks = false;
  }
}
setInterval(() => void pollTelegramLinkConfirmations(), 2_500);

let pollingTelegramLogins = false;
async function pollTelegramLoginRequests() {
  if (!telegramBridgeSecret || pollingTelegramLogins) return;
  pollingTelegramLogins = true;
  try {
    const result = await telegramApi("/telegram/login/pending", {});
    const requests = Array.isArray(result.requests) ? result.requests : [];
    const activeIds = new Set<number>();
    for (const item of requests) {
      if (!item || typeof item !== "object") continue;
      const telegramId = Number((item as Record<string, unknown>).telegramId);
      const nickname = String((item as Record<string, unknown>).nickname || "");
      if (!Number.isSafeInteger(telegramId) || telegramId <= 0 || !nickname) continue;
      activeIds.add(telegramId);
      if (shownTelegramLoginRequests.has(telegramId)) continue;
      shownTelegramLoginRequests.add(telegramId);
      await bot.telegram.sendMessage(telegramId,
        `🔐 <b>Подтвердите вход в AURA</b>\n\nАккаунт: <b>${nickname}</b>\n\nЕсли это не вы, отклоните вход.`, {
          parse_mode: "HTML",
          ...Markup.inlineKeyboard([[
            Markup.button.callback("✅ Подтвердить", "login:approve"),
            Markup.button.callback("⛔ Отклонить", "login:deny")
          ]])
        });
    }
    for (const telegramId of shownTelegramLoginRequests) {
      if (!activeIds.has(telegramId)) shownTelegramLoginRequests.delete(telegramId);
    }
  } catch (error) {
    console.error("Telegram login request check failed", error);
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
