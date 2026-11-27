import type PgBoss from 'pg-boss';
import { logger } from '../../lib/logger.js';
import { alertsService } from './alerts.service.js';

const Q = {
  prices: 'alerts.evaluate-prices',
  market: 'alerts.evaluate-market',
  digests: 'alerts.digests',
  news: 'alerts.poll-news',
  election: 'alerts.poll-election',
  maintenance: 'alerts.maintenance',
} as const;
export const queues = Object.values(Q);

const job = (name: string, fn: () => Promise<unknown>) => async () => {
  const n = await fn();
  if (n) logger.info({ job: name, n }, 'alerts job');
};

export async function registerWorkers(boss: PgBoss) {
  await boss.work(Q.prices, job(Q.prices, () => alertsService.evaluatePrices()));
  await boss.schedule(Q.prices, '* * * * *');
  await boss.work(Q.market, job(Q.market, () => alertsService.evaluateMarket()));
  await boss.schedule(Q.market, '*/10 * * * *');
  await boss.work(Q.digests, job(Q.digests, () => alertsService.digests()));
  await boss.schedule(Q.digests, '2 * * * *');
  await boss.work(Q.news, job(Q.news, () => alertsService.pollNews()));
  await boss.schedule(Q.news, '*/15 * * * *');
  await boss.work(Q.election, job(Q.election, () => alertsService.pollElection()));
  await boss.schedule(Q.election, '11 * * * *');
  await boss.work(Q.maintenance, job(Q.maintenance, () => alertsService.maintenance()));
  await boss.schedule(Q.maintenance, '*/15 * * * *');
}
