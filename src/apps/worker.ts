import { sql } from '../db/client.js';
import { boss, startBoss } from '../jobs/queue.js';
import { allQueues, registerAllWorkers } from '../jobs/registry.js';
import { logger } from '../lib/logger.js';

await startBoss(allQueues);
await registerAllWorkers(boss);
logger.info({ queues: allQueues }, 'worker started');

async function shutdown(signal: string) {
  logger.info({ signal }, 'shutting down worker');
  await boss.stop();
  await sql.end();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
