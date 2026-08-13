import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export type TicketKind = "idea" | "bug" | "report";
export type Ticket = {
  id: string;
  kind: TicketKind;
  text: string;
  minecraftNick?: string;
  targetNick?: string;
  createdAt: string;
  user: { id: number; username?: string; name: string };
};
export type Order = {
  id: string;
  productId: string;
  productTitle: string;
  amountRub: number;
  auraAmount?: number;
  minecraftNick: string;
  createdAt: string;
  paidAt?: string;
  user: { id: number; username?: string; name: string };
};
type Database = { tickets: Ticket[]; orders: Order[] };

// Amvera mounts durable storage at /data. Local development stays self-contained.
const dataDir = process.env.DATA_DIR || (process.platform === "linux" ? "/data" : join(process.cwd(), "data"));
const dbPath = join(dataDir, "aura-bot.json");
let queue = Promise.resolve();

async function readDb(): Promise<Database> {
  try { return JSON.parse(await readFile(dbPath, "utf8")) as Database; }
  catch { return { tickets: [], orders: [] }; }
}
async function mutate(mutator: (db: Database) => void) {
  queue = queue.then(async () => {
    await mkdir(dataDir, { recursive: true });
    const db = await readDb();
    mutator(db);
    await writeFile(dbPath, JSON.stringify(db, null, 2), "utf8");
  });
  return queue;
}
export async function saveTicket(ticket: Ticket) { await mutate((db) => db.tickets.push(ticket)); }
export async function saveOrder(order: Order) { await mutate((db) => db.orders.push(order)); }
export async function markOrderPaid(id: string) { await mutate((db) => { const order = db.orders.find((item) => item.id === id); if (order) order.paidAt = new Date().toISOString(); }); }
