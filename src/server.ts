import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { runReminderScheduler } from './modules/push/service.js';

const config = loadConfig();
const app = await buildApp(config);
try {
  await app.listen({ port: config.PORT, host: '0.0.0.0' });
  // Scheduler roda a cada 60s
  setInterval(() => {
    runReminderScheduler().catch((err) => app.log.error({ err }, 'reminder scheduler failed'));
  }, 60_000);
  app.log.info('reminder scheduler started (60s interval)');
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
