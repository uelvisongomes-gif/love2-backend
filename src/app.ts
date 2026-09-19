import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { loadConfig, type AppConfig } from './config.js';
import { healthRoutes } from './modules/health/routes.js';
import { authRoutes } from './modules/auth/routes.js';
import authPlugin from './modules/auth/auth-plugin.js';
import { couplesRoutes } from './modules/couples/routes.js';
import { consentRoutes } from './modules/consent/routes.js';
import { loveRoutes } from './modules/love/routes.js';
import { profileRoutes } from './modules/profile/routes.js';
import { checkinsRoutes } from './modules/checkins/routes.js';
import { journalRoutes } from './modules/journal/routes.js';
import { tasksRoutes } from './modules/tasks/routes.js';
import { healthIndexRoutes } from './modules/health-index/routes.js';
import { conflictsRoutes } from './modules/conflicts/routes.js';
import { agreementsRoutes } from './modules/agreements/routes.js';
import { pushRoutes } from './modules/push/routes.js';

export async function buildApp(config: AppConfig = loadConfig()): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: config.LOG_LEVEL,
      transport:
        config.NODE_ENV === 'development'
          ? { target: 'pino-pretty', options: { colorize: true } }
          : undefined,
    },
  });
  await app.register(cors, {
    origin: [
      'http://localhost:3001',
      'https://www.love2.com.br',
      'https://love2.com.br',
      /\.vercel\.app$/,
    ],
    credentials: true,
  });
  await app.register(authPlugin);
  await app.register(healthRoutes);
  await app.register(authRoutes);
  await app.register(couplesRoutes);
  await app.register(consentRoutes);
  await app.register(loveRoutes);
  await app.register(profileRoutes);
  await app.register(checkinsRoutes);
  await app.register(journalRoutes);
  await app.register(tasksRoutes);
  await app.register(healthIndexRoutes);
  await app.register(conflictsRoutes);
  await app.register(agreementsRoutes);
  await app.register(pushRoutes);
  return app;
}
