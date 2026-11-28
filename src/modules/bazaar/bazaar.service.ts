import { fetchBazaar } from '../../ingest/hypixel.js';
import { boss } from '../../jobs/queue.js';
import { NotFoundError, UpstreamError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { displayName } from './bazaar.names.js';
import { BAZAAR_QUEUES } from './bazaar.queues.js';
import { bazaarRepo, type BazaarRow } from './bazaar.repo.js';

let lastUpstreamUpdate = 0;

type Product = NonNullable<Awaited<ReturnType<typeof bazaarRepo.find>>>;

function toDto(p: Product) {
  return {
    id: p.productId,
    name: displayName(p.productId),
    buyPrice: p.buyPrice,
    sellPrice: p.sellPrice,
    margin: p.buyPrice - p.sellPrice,
    buyVolume: p.buyVolume,
    sellVolume: p.sellVolume,
    buyMovingWeek: p.buyMovingWeek,
    sellMovingWeek: p.sellMovingWeek,
    buyOrders: p.buyOrders,
    sellOrders: p.sellOrders,
    updatedAt: p.upstreamUpdatedAt,
  };
}

export const bazaarService = {
  // Called every ~30s by the worker. Skips if Hypixel hasn't published new data.
  async pollLatest() {
    const data = await fetchBazaar();
    if (!data.success) throw new UpstreamError(200, 'bazaar returned success=false');
    if (data.lastUpdated === lastUpstreamUpdate) return;

    const upstreamUpdatedAt = new Date(data.lastUpdated);
    const polledAt = new Date();
    const rows: BazaarRow[] = Object.values(data.products).map(({ quick_status: q, buy_summary, sell_summary }) => ({
      // Order book tops for the depth chart. In Hypixel's naming, buy_summary are sell offers
      // (what you buy from) and sell_summary are buy orders (what you sell into).
      buySummary: buy_summary.slice(0, 15),
      sellSummary: sell_summary.slice(0, 15),
      productId: q.productId,
      buyPrice: q.buyPrice,
      sellPrice: q.sellPrice,
      buyVolume: Math.round(q.buyVolume),
      sellVolume: Math.round(q.sellVolume),
      buyMovingWeek: Math.round(q.buyMovingWeek),
      sellMovingWeek: Math.round(q.sellMovingWeek),
      buyOrders: Math.round(q.buyOrders),
      sellOrders: Math.round(q.sellOrders),
      upstreamUpdatedAt,
      polledAt,
    }));

    await bazaarRepo.upsertLatest(rows);
    lastUpstreamUpdate = data.lastUpdated;
    logger.debug({ products: rows.length }, 'bazaar latest updated');
  },

  async snapshot() {
    const count = await bazaarRepo.snapshotAll();
    logger.info({ count }, 'bazaar snapshot taken');
    return count;
  },

  async requestSnapshot() {
    await boss.send(BAZAAR_QUEUES.snapshot, {});
  },

  async list(q?: string) {
    const rows = await bazaarRepo.list();
    const products = rows.map(toDto);
    if (!q) return products;
    const needle = q.toLowerCase();
    return products.filter(
      (p) => p.id.toLowerCase().includes(needle) || p.name.toLowerCase().includes(needle),
    );
  },

  async get(productId: string) {
    const row = await bazaarRepo.find(productId);
    if (!row) throw new NotFoundError(`bazaar product ${productId}`);
    return toDto(row);
  },

  // Raw price history is free at every range: Hypixel requires paywalled API content to be
  // transformative, so only computed insight (depth, spread, seasonality, flips) is gated.
  async history(productId: string, days: number) {
    if (!(await bazaarRepo.find(productId))) throw new NotFoundError(`bazaar product ${productId}`);
    const since = new Date(Date.now() - days * 86_400_000);
    return bazaarRepo.history(productId, since);
  },
};
