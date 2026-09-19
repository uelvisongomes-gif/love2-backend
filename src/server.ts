import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { runReminderScheduler } from './modules/push/service.js';
import { runCycleNotifications } from './modules/cycle/service.js';

const config = loadConfig();
const app = await buildApp(config);
try {
  await app.listen({ port: config.PORT, host: '0.0.0.0' });
  // Scheduler de tarefas roda a cada 60s
  setInterval(() => {
    runReminderScheduler().catch((err) => app.log.error({ err }, 'reminder scheduler failed'));
  }, 60_000);
  app.log.info('reminder scheduler started (60s interval)');

  // Scheduler do ciclo roda a cada 1h (verifica se algum parceiro precisa receber aviso hoje)
  setInterval(() => {
    runCycleNotifications().catch((err) => app.log.error({ err }, 'cycle scheduler failed'));
  }, 60 * 60 * 1000);
  // Roda também logo ao iniciar
  runCycleNotifications().catch((err) => app.log.error({ err }, 'cycle scheduler first-run failed'));
  app.log.info('cycle notification scheduler started (1h interval)');
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
