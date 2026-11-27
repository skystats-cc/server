import type PgBoss from 'pg-boss';
import { logger } from '../../lib/logger.js';
import { accountsRepo } from './accounts.repo.js';

const CLEANUP = 'accounts.cleanup';
export const queues = [CLEANUP];

export async function registerWorkers(boss: PgBoss) {
  await boss.work(CLEANUP, async () => {
    const removed = await accountsRepo.cleanup();
    logger.info(removed, 'expired sessions/pairings removed');
  });
  await boss.schedule(CLEANUP, '17 4 * * *'); // daily
}
