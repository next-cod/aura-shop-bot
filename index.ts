import "dotenv/config";
import { createServer } from "node:http";
import { Telegraf, Markup, type Context } from "telegraf";

const token = process.env.BOT_TOKEN;
if (!token) throw new Error("BOT_TOKEN is missing.");

const bridgeUrl = process.env.AURA_TELEGRAM_API_URL;
const bridgeSecret = process.env.AURA_TELEGRAM_SECRET;
const bot = new Telegraf(token);

type LinkRequest = { nickname?: string };
const pendingLinks = new Map<number, LinkRequest>();

const linkKeyboard = Markup.inlineKeyboard([
  [Markup.button.callback("🔗 Привязать аккаунт", "link:start")]
]);

const safeAnswer = (ctx: Context, text?: string) => ctx.answerCbQuery(text).catch(() => undefined);
const isNickname = (value: string) => /^[A-Za-z0-9_]{3,16}$/.test(value);

function bridgeIsConfigured() {
  return Boolean(bridgeUrl && bridgeSecret);
}

async function bridge(path: string, payload: Record<string, string>) {
  if (!bridgeIsConfigured()) throw new Error("Telegram bridge is not configured");
  const response = await fetch(`${bridgeUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Aura-Secret": bridgeSecret! },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10_000)
  });
  if (!response.ok) throw new Error(`Bridge returned HTTP ${response.status}`);
  return response.json() as Promise<{ ok?: boolean; code?: string; confirmed?: boolean }>;
}

async function showStart(ctx: Context) {
  await ctx.reply(
    "<b>🔗 Привязка Telegram к AURA</b>\n\nНажми кнопку ниже, введи свой игровой ник и подтверди запрос в Minecraft.",
    { parse_mode: "HTML", ...linkKeyboard }
  );
}

async function beginLink(ctx: Context) {
  if (!bridgeIsConfigured()) {
    await ctx.reply("Привязка к серверу временно недоступна. Попробуй чуть позже.");
    return;
  }
  pendingLinks.set(ctx.from!.id, {});
  await ctx.reply("Отправь свой игровой ник Minecraft. Перед этим зайди на сервер и выполни <code>/link telegram</code>.", { parse_mode: "HTML" });
}

bot.use(async (ctx, next) => {
  if (ctx.callbackQuery) await safeAnswer(ctx);
  return next();
});

// Any payload after /start is ignored: it must never be treated as an obsolete link code.
bot.start(showStart);
bot.command("link", beginLink);
bot.action("link:start", beginLink);

bot.on("text", async (ctx) => {
  const pending = pendingLinks.get(ctx.from.id);
  if (!pending || pending.nickname) {
    await ctx.reply("Нажми «Привязать аккаунт», чтобы начать.", linkKeyboard);
    return;
  }

  const nickname = ctx.message.text.trim();
  if (!isNickname(nickname)) {
    await ctx.reply("Ник должен состоять из 3–16 латинских букв, цифр или символа _. Попробуй ещё раз.");
    return;
  }

  try {
    const result = await bridge("/telegram/link/request", { telegramId: String(ctx.from.id), nickname });
    if (!result.ok) {
      const message = result.code === "open_link_in_game"
        ? "Сначала зайди в Minecraft и выполни <code>/link telegram</code>, затем повтори привязку."
        : "Не удалось начать привязку. Проверь ник и попробуй ещё раз.";
      await ctx.reply(message, { parse_mode: "HTML" });
      return;
    }
    pending.nickname = nickname;
    await ctx.reply(`Запрос для <b>${nickname}</b> отправлен. Подтверди его в Minecraft.`, { parse_mode: "HTML" });
  } catch (error) {
    console.error("Telegram link request failed", error);
    await ctx.reply("Сервер привязки сейчас недоступен. Попробуй чуть позже.");
  }
});

async function pollLinkConfirmations() {
  if (!bridgeIsConfigured()) return;
  for (const [telegramId, request] of pendingLinks) {
    if (!request.nickname) continue;
    try {
      const status = await bridge("/telegram/link/status", { telegramId: String(telegramId), nickname: request.nickname });
      if (!status.confirmed) continue;
      const result = await bridge("/telegram/link/finish", { telegramId: String(telegramId), nickname: request.nickname });
      if (!result.ok) continue;
      await bot.telegram.sendMessage(telegramId, `✅ Аккаунт <b>${request.nickname}</b> успешно привязан к Telegram.`, { parse_mode: "HTML" });
      pendingLinks.delete(telegramId);
    } catch (error) {
      console.error("Telegram link status check failed", error);
    }
  }
}

setInterval(() => void pollLinkConfirmations(), 3_000);
bot.catch((error) => console.error("Telegram bot error", error));

async function launchWithRetry() {
  for (;;) {
    try {
      await bot.launch();
      console.log("AURA Telegram link bot is running");
      return;
    } catch (error) {
      console.error("Unable to start AURA Telegram link bot; retrying in 5 seconds", error);
      await new Promise((resolve) => setTimeout(resolve, 5_000));
    }
  }
}
void launchWithRetry();

createServer((_request, response) => {
  response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify({ status: "ok", service: "aura-telegram-link" }));
}).listen(Number(process.env.PORT || 80), "0.0.0.0");
