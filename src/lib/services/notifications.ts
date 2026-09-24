import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

type Db = Prisma.TransactionClient | typeof prisma;

export type NotificationType = "info" | "success" | "warning" | "danger";

/**
 * Creates an in-app notification for a user. Telegram delivery (when the user
 * has linked a chat) is fire-and-forget and never blocks the caller.
 */
export async function notifyUser(
  params: { userId: string; title: string; message: string; type?: NotificationType; link?: string },
  db: Db = prisma,
) {
  const notification = await db.notification.create({
    data: {
      userId: params.userId,
      title: params.title,
      message: params.message,
      type: params.type ?? "info",
      link: params.link ?? null,
    },
  });
  void deliverTelegram(params.userId, `${params.title}\n${params.message}`).catch(() => undefined);
  return notification;
}

export async function listNotificationsForUser(userId: string, take = 20) {
  const [items, unread] = await Promise.all([
    prisma.notification.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take }),
    prisma.notification.count({ where: { userId, read: false } }),
  ]);
  return { items, unread };
}

export async function markNotificationsRead(userId: string, ids?: string[]) {
  await prisma.notification.updateMany({
    where: { userId, read: false, ...(ids && ids.length > 0 ? { id: { in: ids } } : {}) },
    data: { read: true },
  });
}

/** Sends a Telegram message to the user's linked chat, if any and if a bot token is configured. */
async function deliverTelegram(userId: string, text: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { telegramChatId: true } });
  if (!user?.telegramChatId) return;
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: user.telegramChatId, text }),
  });
}

/** Ops alert to the configured Telegram operations chat (feed outages, breaches, payouts). */
export async function alertOps(text: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_OPS_CHAT_ID;
  if (!token || !chatId) return;
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
  } catch {
    // never let an alert failure affect the caller
  }
}
