import webpush from 'web-push';
import { prisma } from '../../db/client.js';
import { loadConfig } from '../../config.js';

let vapidConfigured = false;

function ensureVapid(): void {
  if (vapidConfigured) return;
  const cfg = loadConfig();
  if (!cfg.VAPID_PUBLIC_KEY || !cfg.VAPID_PRIVATE_KEY) return;
  webpush.setVapidDetails(
    `mailto:${cfg.VAPID_CONTACT_EMAIL}`,
    cfg.VAPID_PUBLIC_KEY,
    cfg.VAPID_PRIVATE_KEY,
  );
  vapidConfigured = true;
}

export interface SubscribeInput {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  userAgent?: string;
}

export async function subscribe(userId: string, input: SubscribeInput) {
  return prisma.pushSubscription.upsert({
    where: { endpoint: input.endpoint },
    create: {
      userId,
      endpoint: input.endpoint,
      p256dh: input.keys.p256dh,
      auth: input.keys.auth,
      userAgent: input.userAgent,
    },
    update: {
      userId, // atualiza owner se mudou de conta no mesmo navegador
      p256dh: input.keys.p256dh,
      auth: input.keys.auth,
      userAgent: input.userAgent,
    },
  });
}

export async function unsubscribe(endpoint: string): Promise<void> {
  await prisma.pushSubscription.deleteMany({ where: { endpoint } });
}

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
  tag?: string;
}

export async function sendTestNotification(userId: string): Promise<{
  configured: boolean;
  subscriptions: number;
  sent: number;
}> {
  ensureVapid();
  const cfg = loadConfig();
  const configured = !!cfg.VAPID_PUBLIC_KEY && !!cfg.VAPID_PRIVATE_KEY;
  const subs = await prisma.pushSubscription.findMany({ where: { userId } });
  if (!configured) return { configured, subscriptions: subs.length, sent: 0 };
  const sent = await sendToUser(userId, {
    title: 'love2 — teste',
    body: 'Se você tá vendo essa mensagem, notificações funcionam!',
    url: '/tarefas',
    tag: 'test',
  });
  return { configured, subscriptions: subs.length, sent };
}

async function sendToUser(userId: string, payload: PushPayload): Promise<number> {
  ensureVapid();
  const cfg = loadConfig();
  if (!cfg.VAPID_PUBLIC_KEY || !cfg.VAPID_PRIVATE_KEY) return 0;
  const subs = await prisma.pushSubscription.findMany({ where: { userId } });
  let sent = 0;
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          JSON.stringify(payload),
        );
        sent++;
      } catch (err) {
        const e = err as { statusCode?: number; message?: string; body?: string };
        console.log(`[push] send fail status=${e.statusCode} message=${e.message} body=${e.body}`);
        if (e.statusCode === 404 || e.statusCode === 410) {
          // subscription morreu — remove
          await prisma.pushSubscription.deleteMany({ where: { endpoint: s.endpoint } });
        }
      }
    }),
  );
  return sent;
}

/**
 * Roda a cada 60s. Busca tarefas com remindAt no passado (últimos 5 min) que ainda não
 * foram notificadas, envia push pra quem tá atribuído (ou pros dois se assignedTo=null),
 * e registra em TaskReminderLog.
 */
export async function runReminderScheduler(): Promise<{ notified: number }> {
  const now = new Date();
  const from = new Date(now.getTime() - 5 * 60 * 1000);

  const cfg = loadConfig();
  const configured = !!cfg.VAPID_PUBLIC_KEY && !!cfg.VAPID_PRIVATE_KEY;

  const due = await prisma.coupleTask.findMany({
    where: {
      remindAt: { gte: from, lte: now },
      completedAt: null,
    },
    select: {
      id: true,
      title: true,
      remindAt: true,
      assignedTo: true,
      coupleId: true,
    },
  });
  if (due.length > 0) {
    console.log(`[scheduler] tick — vapid=${configured} due=${due.length}`, due.map((d) => ({
      id: d.id,
      title: d.title,
      remindAt: d.remindAt?.toISOString(),
    })));
  }

  let total = 0;
  for (const task of due) {
    if (!task.remindAt) continue;
    // Já notificou?
    const already = await prisma.taskReminderLog.findFirst({
      where: { taskId: task.id, remindAt: task.remindAt },
      select: { id: true },
    });
    if (already) {
      console.log(`[scheduler] skip ${task.id} — já notificado`);
      continue;
    }

    let recipients: string[];
    if (task.assignedTo) {
      recipients = [task.assignedTo];
    } else if (task.coupleId) {
      const couple = await prisma.couple.findUnique({
        where: { id: task.coupleId },
        select: { userAId: true, userBId: true },
      });
      recipients = couple ? [couple.userAId, couple.userBId] : [];
    } else {
      // Tarefa solo — pega quem criou
      const t = await prisma.coupleTask.findUnique({
        where: { id: task.id },
        select: { createdBy: true },
      });
      recipients = t ? [t.createdBy] : [];
    }
    console.log(`[scheduler] processing task ${task.id} recipients=${JSON.stringify(recipients)}`);
    for (const uid of recipients) {
      const subs = await prisma.pushSubscription.count({ where: { userId: uid } });
      console.log(`[scheduler] user ${uid} has ${subs} subscriptions`);
      const sent = await sendToUser(uid, {
        title: 'love2 — lembrete',
        body: task.title,
        url: '/tarefas',
        tag: `task-${task.id}`,
      });
      console.log(`[scheduler] sent=${sent} for user ${uid}`);
      total += sent;
    }
    await prisma.taskReminderLog.create({
      data: { taskId: task.id, remindAt: task.remindAt },
    });
  }
  return { notified: total };
}
