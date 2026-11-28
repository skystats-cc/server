import type PgBoss from 'pg-boss';
import { every } from '../../jobs/loop.js';
import { logger } from '../../lib/logger.js';
import { marketService } from './market.service.js';

const Q = {
  items: 'market.sync-items',
  bins: 'market.lowest-bins',
  auctionRollup: 'market.auction-rollup',
  recipes: 'market.sync-recipes',
  anomalies: 'market.scan-anomalies',
  correlations: 'market.correlations',
  methods: 'market.method-values',
} as const;
export const queues = Object.values(Q);

const run = (name: string, fn: () => Promise<unknown>) => async () => {
  const n = await fn();
  logger.info({ job: name, n }, 'market job');
};

export async function registerWorkers(boss: PgBoss) {
  // Ended auctions cover the last ~60s, so poll every 50s
  every('market.ended-auctions', 50_000, () => marketService.ingestEndedAuctions());
  await boss.work(Q.items, run(Q.items, () => marketService.syncItems()));
  await boss.schedule(Q.items, '23 5 * * *');
  await boss.work(Q.bins, run(Q.bins, () => marketService.refreshLowestBins()));
  await boss.schedule(Q.bins, '*/10 * * * *');
  await boss.work(Q.auctionRollup, run(Q.auctionRollup, () => marketService.rollupAuctions()));
  await boss.schedule(Q.auctionRollup, '4 * * * *');
  await boss.work(Q.recipes, run(Q.recipes, () => marketService.syncRecipes()));
  await boss.schedule(Q.recipes, '41 4 * * 0');
  await boss.work(Q.anomalies, run(Q.anomalies, () => marketService.scanAnomalies()));
  await boss.schedule(Q.anomalies, '13 * * * *');
  await boss.work(Q.correlations, run(Q.correlations, () => marketService.computeCorrelations()));
  await boss.schedule(Q.correlations, '7 3 * * 1');
  await boss.work(Q.methods, run(Q.methods, () => marketService.recordMethodValues()));
  await boss.schedule(Q.methods, '31 * * * *');
}
