import { sql } from '../db/client.js';
import { buildServer } from '../http/server.js';
import { boss, startBoss } from '../jobs/queue.js';
import { allQueues } from '../jobs/registry.js';
import { config } from '../lib/config.js';
import { logger } from '../lib/logger.js';

// The API only *sends* jobs; the worker process runs them.
await startBoss(allQueues);
const app = await buildServer();
await app.listen({ host: config.HOST, port: config.PORT });

async function shutdown(signal: string) {
  logger.info({ signal }, 'shutting down api');
  await app.close();
  await boss.stop();
  await sql.end();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
