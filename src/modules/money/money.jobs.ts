import type PgBoss from 'pg-boss';
import { logger } from '../../lib/logger.js';
import { moneyService } from './money.service.js';

const ROLLUP = 'money.rollup-daily';
const RETENTION = 'money.enforce-retention';
export const queues = [ROLLUP, RETENTION];

export async function registerWorkers(boss: PgBoss) {
  await boss.work(ROLLUP, async () => {
    const rows = await moneyService.rollup();
    logger.info({ rows }, 'money daily rollup');
  });
  await boss.schedule(ROLLUP, '7 * * * *'); // hourly

  await boss.work(RETENTION, async () => {
    const deleted = await moneyService.enforceRetention();
    logger.info({ deleted }, 'money retention enforced');
  });
  await boss.schedule(RETENTION, '37 3 * * *'); // daily
}
