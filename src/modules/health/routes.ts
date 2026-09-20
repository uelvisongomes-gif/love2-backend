import type { FastifyInstance } from 'fastify';
import { prisma } from '../../db/client.js';
import { loadConfig } from '../../config.js';

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health', async () => ({ status: 'ok', uptime: process.uptime() }));

  /**
   * Health check profundo: valida DB, WAME e módulos críticos.
   * Se falhar, retorna 503 — Railway pode usar pra decidir se promove o deploy.
   */
  app.get('/health/deep', async (_req, reply) => {
    const cfg = loadConfig();
    const results: Record<string, { ok: boolean; message?: string }> = {};

    // 1. DB conecta
    try {
      await prisma.$queryRaw`SELECT 1`;
      results.db = { ok: true };
    } catch (err) {
      results.db = { ok: false, message: err instanceof Error ? err.message : String(err) };
    }

    // 2. Prisma User model funciona (bug guard — se schema mudou e migração não rodou)
    try {
      await prisma.user.count();
      results.user_model = { ok: true };
    } catch (err) {
      results.user_model = { ok: false, message: err instanceof Error ? err.message : String(err) };
    }

    // 3. Prisma Profile com campo gender (Etapa 2)
    try {
      await prisma.profile.findFirst({ select: { gender: true } });
      results.profile_gender = { ok: true };
    } catch (err) {
      results.profile_gender = { ok: false, message: err instanceof Error ? err.message : String(err) };
    }

    // 4. WAME reachable (só se habilitado)
    if (cfg.WAME_ENABLED && cfg.WAME_API_KEY) {
      try {
        const url = `${cfg.WAME_SERVER}/${cfg.WAME_API_KEY}/instance`;
        const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
        results.wame = { ok: res.ok, message: res.ok ? undefined : `HTTP ${res.status}` };
      } catch (err) {
        results.wame = { ok: false, message: err instanceof Error ? err.message : String(err) };
      }
    } else {
      results.wame = { ok: true, message: 'disabled' };
    }

    // 5. UserPhoneLink model (Etapa WhatsApp)
    try {
      await prisma.userPhoneLink.count();
      results.user_phone_link = { ok: true };
    } catch (err) {
      results.user_phone_link = { ok: false, message: err instanceof Error ? err.message : String(err) };
    }

    const allOk = Object.values(results).every((r) => r.ok);
    reply.code(allOk ? 200 : 503);
    return { status: allOk ? 'ok' : 'degraded', checks: results };
  });
}
