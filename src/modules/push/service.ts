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
    // Manda push (se tiver subscription) E email (sempre)
    for (const uid of recipients) {
      const [subs, user] = await Promise.all([
        prisma.pushSubscription.count({ where: { userId: uid } }),
        prisma.user.findUnique({ where: { id: uid }, select: { email: true, name: true } }),
      ]);
      console.log(`[scheduler] user ${uid} has ${subs} push subscriptions`);
      // Push (opcional)
      const sent = await sendToUser(uid, {
        title: 'love2 — lembrete',
        body: task.title,
        url: '/tarefas',
        tag: `task-${task.id}`,
      });
      console.log(`[scheduler] push sent=${sent} for user ${uid}`);
      total += sent;
      // Email (sempre)
      if (user?.email) {
        try {
          const { getEmailSender } = await import('../auth/email.js');
          const subject = `🔔 love2 — ${task.title}`;
          const text = `Oi${user.name ? `, ${user.name}` : ''}!\n\nSó lembrando: ${task.title}\n\nAcessa em https://www.love2.com.br/tarefas\n\n— love2`;
          const html = `<div style="font-family: system-ui, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
            <h2 style="color: #c9694a; font-weight: 500;">🔔 Lembrete do love2</h2>
            <p style="font-size: 16px; color: #333;">Oi${user.name ? `, ${user.name}` : ''}! Só passando pra lembrar:</p>
            <div style="background: #faf7f2; border-left: 3px solid #c9694a; padding: 16px; border-radius: 4px; margin: 16px 0;">
              <strong style="font-size: 18px; color: #222;">${task.title}</strong>
            </div>
            <a href="https://www.love2.com.br/tarefas" style="display: inline-block; background: #c9694a; color: white; padding: 12px 24px; border-radius: 999px; text-decoration: none; font-weight: 600; margin-top: 8px;">Ver na love2</a>
            <p style="color: #999; font-size: 12px; margin-top: 32px;">Você tá recebendo esse email porque criou uma tarefa com hora de lembrete no love2.</p>
          </div>`;
          await getEmailSender().send(user.email, subject, text, html);
          console.log(`[scheduler] email sent to ${user.email}`);
        } catch (err) {
          console.log(`[scheduler] email fail: ${(err as Error).message}`);
        }
      }
    }
    await prisma.taskReminderLog.create({
      data: { taskId: task.id, remindAt: task.remindAt },
    });
  }
  return { notified: total };
}
