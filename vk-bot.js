import "dotenv/config";
import { mkdir, readFile, writeFile } from "node:fs/promises";

const token = process.env.VK_GROUP_TOKEN;
const groupId = Number(process.env.VK_GROUP_ID);
const bridge = process.env.AURA_VK_API_URL || "http://213.171.18.146:22243";
const secret = process.env.AURA_VK_SECRET;
if (!token || !groupId || !secret) throw new Error("Fill VK_GROUP_TOKEN, VK_GROUP_ID and AURA_VK_SECRET in .env");

const usersPath = new URL("./data/vk-users.json", import.meta.url);
let users = {};
try { users = JSON.parse(await readFile(usersPath, "utf8")); } catch { /* first start */ }
await mkdir(new URL("./data/", import.meta.url), { recursive: true });
const save = () => writeFile(usersPath, JSON.stringify(users, null, 2));

const TEXT = {
  link: "🔗 Привязать аккаунт",
  kick: "🚪 Кикнуть аккаунт",
  reset: "🔐 Восстановить пароль",
  twoFactor: "🛡 Отключить 2FA",
  unlink: "🔓 Отвязать аккаунт",
  approve: "✅ Подтвердить вход",
  deny: "❌ Отклонить вход"
};

const menu = JSON.stringify({ one_time: false, buttons: [
  [{ action: { type: "text", label: TEXT.link }, color: "primary" }],
  [{ action: { type: "text", label: TEXT.kick }, color: "negative" }, { action: { type: "text", label: TEXT.reset }, color: "secondary" }],
  [{ action: { type: "text", label: TEXT.twoFactor }, color: "secondary" }, { action: { type: "text", label: TEXT.unlink }, color: "negative" }]
] });

async function vk(method, params = {}) {
  const body = new URLSearchParams({ ...params, access_token: token, v: "5.199" });
  const response = await fetch(`https://api.vk.com/method/${method}`, { method: "POST", body });
  const json = await response.json();
  if (json.error) throw new Error(`${method}: ${json.error.error_msg}`);
  return json.response;
}
async function say(peerId, message, keyboard = menu) {
  return vk("messages.send", { random_id: String(Date.now()) + String(Math.floor(Math.random() * 1000)), peer_id: peerId, message, keyboard });
}
async function aura(path, data) {
  const response = await fetch(`${bridge}${path}`, { method: "POST", headers: { "Content-Type": "application/json", "X-Aura-Secret": secret }, body: JSON.stringify(data) });
  return response.json();
}
function profile(id) { return users[id] ||= { mode: "home" }; }

function is(value, label) { return value === label || value.replace(/^\S+\s+/, "") === label.replace(/^\S+\s+/, ""); }

async function handle(peerId, text) {
  const user = profile(peerId);
  const value = text.trim();
  if (value === "Начать" || value.toLowerCase() === "start" || value === "/start") {
    user.mode = "home"; await save();
    return say(peerId, "Добро пожаловать в Aura. Выберите действие.");
  }
  if (user.mode === "nickname") {
    if (!/^[A-Za-z0-9_]{3,16}$/.test(value)) return say(peerId, "Ник Minecraft должен содержать 3–16 латинских букв, цифр или _. Попробуйте ещё раз.");
    const result = await aura("/vk/link/request", { vkId: String(peerId), nickname: value });
    if (!result.ok) return say(peerId, result.code === "open_link_in_game" ? "Сначала войдите в Minecraft и введите /link, затем повторите попытку." : "Не удалось начать привязку. Проверьте ник.");
    user.nickname = value; user.mode = "waiting_link"; await save();
    return say(peerId, `Запрос отправлен на аккаунт ${value}. Подтвердите его в Minecraft командой /link confirm.`);
  }
  if (user.mode === "login_answer") {
    if (is(value, TEXT.approve)) { await aura("/vk/login/answer", { vkId: String(peerId), allow: "true" }); user.mode = "home"; await save(); return say(peerId, "Вход подтверждён."); }
    if (is(value, TEXT.deny)) { await aura("/vk/login/answer", { vkId: String(peerId), allow: "false" }); user.mode = "home"; await save(); return say(peerId, "Вход отклонён."); }
  }
  if (is(value, TEXT.link)) { user.mode = "nickname"; await save(); return say(peerId, "Введите ник Minecraft. Перед этим игрок должен быть в игре и выполнить /link."); }
  const action = is(value, TEXT.kick) ? "kick" : is(value, TEXT.reset) ? "reset_password" : is(value, TEXT.twoFactor) ? "two_factor_off" : is(value, TEXT.unlink) ? "unlink" : null;
  if (action) {
    const result = await aura("/vk/action", { vkId: String(peerId), action });
    if (!result.ok) return say(peerId, "Аккаунт ещё не привязан или действие сейчас недоступно.");
    if (action === "reset_password") return say(peerId, `Новый пароль: ${result.password}\nСохраните его: старый пароль больше не действует.`);
    if (action === "two_factor_off") return say(peerId, "Двухэтапная авторизация отключена.");
    if (action === "unlink") return say(peerId, "Аккаунт отвязан от ВК.");
    return say(peerId, "Команда на отключение аккаунта отправлена.");
  }
  return say(peerId, "Выберите кнопку из меню.");
}

async function checkPending() {
  for (const [id, user] of Object.entries(users)) {
    if (!user.nickname || user.mode === "waiting_link") {
      if (user.mode === "waiting_link") {
        const status = await aura("/vk/link/status", { vkId: id, nickname: user.nickname });
        if (status.confirmed) {
          const done = await aura("/vk/link/finish", { vkId: id, nickname: user.nickname });
          if (done.ok) { user.mode = "home"; await say(Number(id), "Аккаунт успешно привязан. Двухэтапная защита включена."); await save(); }
        }
      }
      continue;
    }
    const login = await aura("/vk/login/poll", { vkId: id });
    if (login.pending && user.mode !== "login_answer") {
      user.mode = "login_answer"; await save();
      const keyboard = JSON.stringify({ one_time: true, buttons: [[
        { action: { type: "text", label: TEXT.approve }, color: "positive" },
        { action: { type: "text", label: TEXT.deny }, color: "negative" }
      ]] });
      await say(Number(id), `Подтвердить вход в Aura для аккаунта ${login.nickname}?`, keyboard);
    }
  }
}

const health = await fetch(`${bridge}/vk/health`, { signal: AbortSignal.timeout(10_000) });
if (!health.ok) throw new Error(`Aura VK bridge returned HTTP ${health.status}`);
console.log(`Aura VK bridge is reachable at ${bridge}`);

const longPoll = await vk("groups.getLongPollServer", { group_id: groupId });
let ts = longPoll.ts;
setInterval(() => checkPending().catch(error => console.error("pending:", error.message)), 2500);
console.log("Aura VK bot is running.");
while (true) {
  const url = `${longPoll.server}?act=a_check&key=${encodeURIComponent(longPoll.key)}&ts=${ts}&wait=25`;
  const update = await (await fetch(url)).json();
  if (update.failed) { if (update.ts) ts = update.ts; continue; }
  ts = update.ts;
  for (const event of update.updates ?? []) {
    if (event.type !== "message_new") continue;
    const message = event.object.message;
    if (message.from_id > 0) handle(message.peer_id, message.text || "").catch(error => console.error("message:", error.message));
  }
}
