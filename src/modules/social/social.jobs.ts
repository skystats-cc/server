import type PgBoss from 'pg-boss';
import { logger } from '../../lib/logger.js';
import { socialService } from './social.service.js';

const Q = { boards: 'social.leaderboards', achievements: 'social.achievements', predictions: 'social.resolve-predictions' } as const;
export const queues = Object.values(Q);
const run = (name: string, fn: () => Promise<number>) => async () => {
  const n = await fn();
  if (n) logger.info({ job: name, n }, 'social job');
};

export async function registerWorkers(boss: PgBoss) {
  await boss.work(Q.boards, run(Q.boards, () => socialService.computeBoards()));
  await boss.schedule(Q.boards, '*/15 * * * *');
  await boss.work(Q.achievements, run(Q.achievements, () => socialService.awardAchievements()));
  await boss.schedule(Q.achievements, '17 * * * *');
  await boss.work(Q.predictions, run(Q.predictions, () => socialService.resolvePredictions()));
  await boss.schedule(Q.predictions, '29 * * * *');
}
