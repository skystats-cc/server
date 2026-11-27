import { fetchAuctionPage, fetchEndedAuctions, fetchItems } from '../../ingest/hypixel.js';
import { skyblockItem } from '../../ingest/nbt.js';
import { config } from '../../lib/config.js';
import { AppError, ConflictError, ForbiddenError, NotFoundError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { alertsRepo } from '../alerts/alerts.repo.js';
import { robustZ } from '../alerts/rules.js';
import { entitlementsService } from '../entitlements/entitlements.service.js';
import { atLeast, type Tier } from '../entitlements/tiers.js';
import { cheapest, correlation, economyIndex, evaluateMethod, flips, npcArbitrage, seasonality, type MethodSpec, type PriceSource, type Recipe } from './analytics.js';
import { marketRepo } from './market.repo.js';
import { CURATED_METHODS } from './methods/curated.js';

const DAY = 86_400_000;
const pretty = (id: string) => id.toLowerCase().replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
const need = (tier: Tier, min: Tier, what: string) => {
  if (!atLeast(tier, min)) throw new ForbiddenError('upgrade_required', `${what} needs SkyStats ${min === 'pro' ? 'Pro' : 'Max'} or above`);
};

/** Live price lookup shared by methods, crafts and arbitrage */
async function priceBook() {
  const [quotes, itemRows, bins] = await Promise.all([marketRepo.allQuotes(), marketRepo.allItems(), marketRepo.allLowestBins()]);
  const q = new Map(quotes.map((r) => [r.productId, r]));
  const npc = new Map(itemRows.filter((i) => i.npcSellPrice).map((i) => [i.id, i.npcSellPrice!]));
  const bin = new Map(bins.map((b) => [b.itemId, b.price]));
  const names = new Map(itemRows.map((i) => [i.id, i.name]));
  const price = (item: string, source: PriceSource): number | null => {
    if (source === 'npc') return npc.get(item) ?? null;
    if (source === 'bin') return bin.get(item) ?? null;
    const r = q.get(item);
    if (r) return source === 'instabuy' ? r.buyPrice : r.sellPrice;
    return bin.get(item) ?? null; // auction-only items
  };
  const buy = (item: string) => q.get(item)?.buyPrice ?? bin.get(item) ?? null;
  return { quotes, q, npc, bin, names, price, buy, name: (id: string) => names.get(id) ?? pretty(id) };
}

interface CatalogueEntry {
  id: string;
  name: string;
  family: 'curated' | 'flip' | 'npc' | 'craft' | 'custom';
  category: string;
  tier: Tier;
  beta: boolean;
  unit: 'hour' | 'action';
  spec: MethodSpec;
  source: string;
}

async function generatedMethods(book: Awaited<ReturnType<typeof priceBook>>): Promise<CatalogueEntry[]> {
  const out: CatalogueEntry[] = [];
  for (const f of flips(book.quotes, config.BAZAAR_TAX).slice(0, 15)) {
    out.push({
      id: `flip:${f.productId}`,
      name: `Order-flip ${book.name(f.productId)}`,
      family: 'flip',
      category: 'bazaar',
      tier: 'free',
      beta: false,
      unit: 'action',
      source: 'Generated from live bazaar prices after tax. Per item flipped; you also need your orders to fill.',
      spec: { unit: 'action', outputs: [{ item: f.productId, qty: 1 - config.BAZAAR_TAX, source: 'instabuy' }], inputs: [{ item: f.productId, qty: 1, source: 'instasell' }], coins: -0.2 },
    });
  }
  for (const a of npcArbitrage(book.quotes, book.npc).slice(0, 10)) {
    out.push({
      id: `npc:${a.productId}`,
      name: `Sell ${book.name(a.productId)} to an NPC`,
      family: 'npc',
      category: 'bazaar',
      tier: 'free',
      beta: false,
      unit: 'action',
      source: 'Generated: instabuy from the bazaar, sell to an NPC. NPC sell limits may apply.',
      spec: { unit: 'action', outputs: [{ item: a.productId, qty: 1, source: 'npc' }], inputs: [{ item: a.productId, qty: 1, source: 'instabuy' }] },
    });
  }
  const recipes = new Map<string, Recipe>((await marketRepo.allRecipes()).map((r) => [r.outputId, { outputId: r.outputId, outputCount: r.outputCount, inputs: r.inputs as Recipe['inputs'] }]));
  const crafts = [...recipes.values()]
    .filter((r) => book.q.has(r.outputId))
    .map((r) => {
      const cost = r.inputs.reduce<number | null>((s, i) => (s === null || book.buy(i.id) === null ? null : s + book.buy(i.id)! * i.count), 0);
      const value = (book.q.get(r.outputId)!.sellPrice ?? 0) * r.outputCount;
      return { r, profit: cost === null ? null : value - cost };
    })
    .filter((c) => c.profit !== null && c.profit > 0)
    .sort((a, b) => b.profit! - a.profit!)
    .slice(0, 20);
  for (const { r } of crafts) {
    out.push({
      id: `craft:${r.outputId}`,
      name: `Craft ${book.name(r.outputId)}`,
      family: 'craft',
      category: 'crafting',
      tier: 'pro',
      beta: false,
      unit: 'action',
      source: 'Generated: instabuy the ingredients, craft, instasell the result.',
      spec: { unit: 'action', outputs: [{ item: r.outputId, qty: r.outputCount, source: 'instasell' }], inputs: r.inputs.map((i) => ({ item: i.id, qty: i.count, source: 'instabuy' as const })) },
    });
  }
  return out;
}

async function catalogue(book: Awaited<ReturnType<typeof priceBook>>): Promise<CatalogueEntry[]> {
  const curated = CURATED_METHODS.map((m) => ({ ...m, family: 'curated' as const, unit: m.spec.unit }));
  return [...curated, ...(await generatedMethods(book))];
}

function canSee(tier: Tier, m: { tier: Tier; beta: boolean }) {
  return m.beta ? tier === 'max' : atLeast(tier, m.tier);
}

export const marketService = {
  // ------------------------------------------------------------ ingestion
  async syncItems() {
    const { items } = await fetchItems();
    const now = new Date();
    await marketRepo.upsertItems(items.map((i) => ({ id: i.id, name: i.name.replace(/§./g, ''), category: i.category ?? null, tier: i.tier ?? null, npcSellPrice: i.npc_sell_price ?? null, updatedAt: now })));
    return items.length;
  },

  async ingestEndedAuctions() {
    const { auctions } = await fetchEndedAuctions();
    const rows = auctions
      .filter((a) => a.bin)
      .map((a) => ({ a, item: skyblockItem(a.item_bytes) }))
      .filter((x) => x.item)
      .map(({ a, item }) => ({ auctionId: a.auction_id, itemId: item!.id, pricePerUnit: a.price / Math.max(1, item!.count), soldAt: new Date(a.timestamp) }));
    await marketRepo.addSales(rows);
    return rows.length;
  },

  rollupAuctions: () => marketRepo.rollupSales(),

  /** Lowest BIN per item across every active auction page */
  async refreshLowestBins() {
    const best = new Map<string, { price: number; count: number }>();
    let page = 0;
    let total = 1;
    while (page < total && page < 200) {
      const res = await fetchAuctionPage(page);
      total = res.totalPages;
      for (const a of res.auctions) {
        if (!a.bin) continue;
        const item = skyblockItem(a.item_bytes);
        if (!item) continue;
        const unit = a.starting_bid / Math.max(1, item.count);
        const cur = best.get(item.id);
        best.set(item.id, { price: cur ? Math.min(cur.price, unit) : unit, count: (cur?.count ?? 0) + 1 });
      }
      page++;
    }
    const now = new Date();
    await marketRepo.replaceLowestBins([...best].map(([itemId, v]) => ({ itemId, price: v.price, count: v.count, updatedAt: now })));
    return best.size;
  },

  /** Optional recipe import, one JSON file per bazaar item (NEU repo format). Off unless configured. */
  async syncRecipes() {
    if (!config.RECIPES_SOURCE_URL) return 0;
    let n = 0;
    for (const { productId } of await marketRepo.allQuotes()) {
      try {
        const res = await fetch(config.RECIPES_SOURCE_URL.replace('{id}', encodeURIComponent(productId)));
        if (!res.ok) continue;
        const json = (await res.json()) as { recipe?: Record<string, string | number> };
        const grid = json.recipe;
        if (!grid) continue;
        const inputs = new Map<string, number>();
        for (const [slot, v] of Object.entries(grid)) {
          if (!/^[ABC][123]$/.test(slot) || typeof v !== 'string' || !v) continue;
          const [id, count] = v.split(':');
          inputs.set(id!, (inputs.get(id!) ?? 0) + Number(count ?? 1));
        }
        if (inputs.size === 0) continue;
        await marketRepo.upsertRecipe({ outputId: productId, outputCount: Number(grid.count ?? 1) || 1, inputs: [...inputs].map(([id, count]) => ({ id, count })), updatedAt: new Date() });
        n++;
      } catch {
        // skip items without a readable recipe
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    return n;
  },

  /** Hourly: anomaly feed across the whole bazaar */
  async scanAnomalies() {
    const quotes = await marketRepo.allQuotes();
    const hist = new Map<string, number[]>();
    for (const s of await marketRepo.history(quotes.map((q) => q.productId), new Date(Date.now() - 7 * DAY))) hist.set(s.productId, [...(hist.get(s.productId) ?? []), s.buyPrice]);
    const found = quotes
      .filter((q) => q.buyMovingWeek > 1000)
      .map((q) => ({ productId: q.productId, price: q.buyPrice, z: robustZ(hist.get(q.productId) ?? [], q.buyPrice) }))
      .filter((r): r is { productId: string; price: number; z: number } => r.z !== null && Math.abs(r.z) >= 5);
    await marketRepo.addAnomalies(found);
    return found.length;
  },

  /** Weekly: correlations between the 150 most traded items (30 days of 2-hourly prices) */
  async computeCorrelations() {
    const ids = (await marketRepo.topByVolume(150)).map((r) => r.id);
    const series = new Map<string, Map<number, number>>();
    for (const s of await marketRepo.history(ids, new Date(Date.now() - 30 * DAY))) {
      const t = Math.round(s.takenAt.getTime() / 3_600_000);
      if (!series.has(s.productId)) series.set(s.productId, new Map());
      series.get(s.productId)!.set(t, s.buyPrice);
    }
    const times = [...new Set([...series.values()].flatMap((m) => [...m.keys()]))].sort((a, b) => a - b);
    const arr = new Map([...series].map(([id, m]) => [id, times.map((t) => m.get(t) ?? 0)]));
    const rows: { productId: string; otherId: string; r: number; computedAt: Date }[] = [];
    const now = new Date();
    const list = [...arr.keys()];
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const r = correlation(arr.get(list[i]!)!, arr.get(list[j]!)!);
        if (r !== null && Math.abs(r) >= 0.5) {
          rows.push({ productId: list[i]!, otherId: list[j]!, r, computedAt: now }, { productId: list[j]!, otherId: list[i]!, r, computedAt: now });
        }
      }
    }
    await marketRepo.replaceCorrelations(rows);
    return rows.length / 2;
  },

  /** Hourly: value of every public method, for history charts; also records the mayor */
  async recordMethodValues() {
    const book = await priceBook();
    const rows = (await catalogue(book))
      .map((m) => ({ methodId: m.id, value: evaluateMethod(m.spec, book.price).value }))
      .filter((r): r is { methodId: string; value: number } => r.value !== null);
    await marketRepo.recordMethodValues(rows);
    const e = await alertsRepo.election();
    if (e?.year && e.mayor) await marketRepo.recordMayor(e.year, e.mayor, e.perks);
    return rows.length;
  },

  // ------------------------------------------------------------ queries
  async searchItems(q: string) {
    return marketRepo.searchItems(q);
  },

  /** Free: biggest movers over a window */
  async movers(window: '1h' | '24h' | '7d') {
    const ms = { '1h': 3_600_000, '24h': DAY, '7d': 7 * DAY }[window];
    const rows = (await marketRepo.changes(new Date(Date.now() - ms))).filter((r) => r.weekVolume > 1000).map((r) => ({ productId: r.productId, now: r.now, then: r.then, change: r.now / r.then - 1 }));
    const by = (f: (r: (typeof rows)[number]) => number) => [...rows].sort((a, b) => f(b) - f(a)).slice(0, 15);
    return { window, gainers: by((r) => r.change), losers: by((r) => -r.change) };
  },

  /** Free: categories from the items resource, with each category's average 24h change */
  async categories() {
    const [itemRows, changes] = await Promise.all([marketRepo.allItems(), marketRepo.changes(new Date(Date.now() - DAY))]);
    const cat = new Map(itemRows.map((i) => [i.id, (i.category ?? 'other').toLowerCase()]));
    const groups = new Map<string, number[]>();
    for (const c of changes) {
      const k = cat.get(c.productId) ?? 'other';
      groups.set(k, [...(groups.get(k) ?? []), Math.log(c.now / c.then)]);
    }
    return [...groups].map(([category, logs]) => ({ category, products: logs.length, change24h: Math.exp(logs.reduce((s, l) => s + l, 0) / logs.length) - 1 })).sort((a, b) => b.products - a.products);
  },

  /** Free: the SkyBlock economy index (top 50 traded items, equal weight) */
  async economyIndex(days: number) {
    const ids = (await marketRepo.topByVolume(50)).map((r) => r.id);
    const series = new Map<string, { t: number; price: number }[]>();
    for (const s of await marketRepo.history(ids, new Date(Date.now() - days * DAY))) {
      const t = Math.round(s.takenAt.getTime() / 3_600_000) * 3_600_000;
      series.set(s.productId, [...(series.get(s.productId) ?? []), { t, price: s.buyPrice }]);
    }
    return { days, points: economyIndex(series).map((p) => ({ t: new Date(p.t).toISOString(), value: p.value })) };
  },

  /** Free: NPC arbitrage */
  async npcArbitrage() {
    const book = await priceBook();
    return npcArbitrage(book.quotes, book.npc).slice(0, 50).map((r) => ({ ...r, name: book.name(r.productId) }));
  },

  /** Pro: order book depth */
  async depth(accountId: string | null, id: string) {
    need(await entitlementsService.tierOf(accountId), 'pro', 'Order book depth');
    const p = await marketRepo.product(id);
    if (!p) throw new NotFoundError('bazaar item');
    return { productId: id, sellOffers: p.buySummary, buyOrders: p.sellSummary, updatedAt: p.upstreamUpdatedAt };
  },

  /** Pro: spread (margin) over time */
  async spread(accountId: string | null, id: string, days: number) {
    need(await entitlementsService.tierOf(accountId), 'pro', 'Spread history');
    const rows = await marketRepo.history([id], new Date(Date.now() - days * DAY));
    return { productId: id, points: rows.map((r) => ({ t: r.takenAt, spread: r.buyPrice - r.sellPrice, spreadPct: r.sellPrice > 0 ? r.buyPrice / r.sellPrice - 1 : null })) };
  },

  /** Pro: price by hour of day and weekday (last 30 days) */
  async seasonality(accountId: string | null, id: string) {
    need(await entitlementsService.tierOf(accountId), 'pro', 'Seasonality');
    const rows = await marketRepo.history([id], new Date(Date.now() - 30 * DAY));
    return { productId: id, ...seasonality(rows.map((r) => ({ t: r.takenAt, price: r.buyPrice }))) };
  },

  /** Pro: flip finder */
  async flips(accountId: string | null) {
    need(await entitlementsService.tierOf(accountId), 'pro', 'The flip finder');
    const book = await priceBook();
    return { tax: config.BAZAAR_TAX, flips: flips(book.quotes, config.BAZAAR_TAX).slice(0, 100).map((f) => ({ ...f, name: book.name(f.productId) })) };
  },

  /** Pro: craft-or-buy calculator */
  async craft(accountId: string | null, id: string) {
    need(await entitlementsService.tierOf(accountId), 'pro', 'The craft calculator');
    const book = await priceBook();
    const recipes = new Map<string, Recipe>((await marketRepo.allRecipes()).map((r) => [r.outputId, { outputId: r.outputId, outputCount: r.outputCount, inputs: r.inputs as Recipe['inputs'] }]));
    if (!recipes.has(id)) throw new NotFoundError('recipe');
    const plan = cheapest(id, book.buy, recipes);
    const sell = book.q.get(id)?.sellPrice ?? null;
    return { productId: id, name: book.name(id), sellPrice: sell, ...plan, profit: plan.cost !== null && sell !== null ? sell - plan.cost : null };
  },

  /** Pro: unusual moves feed */
  async anomalies(accountId: string | null) {
    need(await entitlementsService.tierOf(accountId), 'pro', 'The anomaly feed');
    return { anomalies: await marketRepo.recentAnomalies() };
  },

  /** Max: items that move together */
  async correlations(accountId: string | null, id: string) {
    need(await entitlementsService.tierOf(accountId), 'max', 'Correlations');
    return { productId: id, related: await marketRepo.correlationsFor(id) };
  },

  /** Free: auction prices (current lowest BIN and hourly medians) */
  async auction(id: string, days: number) {
    const [bin, hist] = await Promise.all([marketRepo.lowestBin(id), marketRepo.auctionHistory(id, new Date(Date.now() - days * DAY))]);
    if (!bin && hist.length === 0) throw new NotFoundError('auction item');
    return { itemId: id, lowestBin: bin?.price ?? null, listings: bin?.count ?? 0, updatedAt: bin?.updatedAt ?? null, history: hist.map((h) => ({ hour: h.hour, median: h.median, min: h.min, sales: h.sales })) };
  },

  async electionHistory() {
    return { mayors: await marketRepo.electionHistory() };
  },

  // ------------------------------------------------------------ watchlist (free, up to 50)
  watchlist: (accountId: string) => marketRepo.watchlist(accountId),
  async watch(accountId: string, productId: string) {
    if (!(await marketRepo.product(productId))) throw new NotFoundError('bazaar item');
    if ((await marketRepo.watchCount(accountId)) >= 50) throw new ConflictError('limit_reached', 'You can watch up to 50 items');
    await marketRepo.watch(accountId, productId);
  },
  unwatch: (accountId: string, productId: string) => marketRepo.unwatch(accountId, productId),

  // ------------------------------------------------------------ methods
  async methods(accountId: string | null) {
    const tier = await entitlementsService.tierOf(accountId);
    const book = await priceBook();
    const votes = new Map((await marketRepo.voteSummary()).map((v) => [v.methodId, v]));
    const list = (await catalogue(book)).map((m) => {
      const visible = canSee(tier, m);
      return {
        id: m.id,
        name: m.name,
        family: m.family,
        category: m.category,
        tier: m.tier,
        beta: m.beta,
        unit: m.unit,
        locked: !visible,
        value: visible ? evaluateMethod(m.spec, book.price).value : null,
        requirements: m.spec.requirements ?? [],
        rating: votes.get(m.id) ?? null,
      };
    });
    const custom = accountId && tier === 'max' ? await marketRepo.customMethods(accountId) : [];
    return {
      tier,
      methods: [
        ...list,
        ...custom.map((c) => ({ id: `custom:${c.id}`, name: c.name, family: 'custom' as const, category: 'custom', tier: 'max' as Tier, beta: false, unit: (c.spec as MethodSpec).unit, locked: false, value: evaluateMethod(c.spec as MethodSpec, book.price).value, requirements: (c.spec as MethodSpec).requirements ?? [], rating: null })),
      ].sort((a, b) => Number(a.locked) - Number(b.locked) || (b.value ?? -Infinity) - (a.value ?? -Infinity)),
    };
  },

  async method(accountId: string | null, id: string) {
    const tier = await entitlementsService.tierOf(accountId);
    const book = await priceBook();
    let m: { id: string; name: string; tier: Tier; beta: boolean; spec: MethodSpec; source: string } | undefined;
    if (id.startsWith('custom:')) {
      const c = await marketRepo.customMethod(id.slice(7));
      if (!c || c.accountId !== accountId) throw new NotFoundError('method');
      m = { id, name: c.name, tier: 'max', beta: false, spec: c.spec as MethodSpec, source: 'Your custom method' };
    } else {
      m = (await catalogue(book)).find((x) => x.id === id);
    }
    if (!m) throw new NotFoundError('method');
    if (!canSee(tier, m)) throw new ForbiddenError('upgrade_required', `This method needs SkyStats ${m.beta || m.tier === 'max' ? 'Max' : 'Pro'}`);
    const { value, lines } = evaluateMethod(m.spec, book.price);
    return { id: m.id, name: m.name, tier: m.tier, beta: m.beta, unit: m.spec.unit, source: m.source, requirements: m.spec.requirements ?? [], value, lines: lines.map((l) => ({ ...l, name: book.name(l.item) })) };
  },

  /** Pro: how a method's value moved over time */
  async methodHistory(accountId: string | null, id: string, days: number) {
    need(await entitlementsService.tierOf(accountId), 'pro', 'Method history');
    return { id, points: await marketRepo.methodHistory(id, new Date(Date.now() - days * DAY)) };
  },

  async vote(accountId: string, methodId: string, v: { vote: 1 | -1; stillWorks?: boolean; difficulty?: number }) {
    if (methodId.startsWith('custom:')) throw new AppError(400, 'bad_request', 'Custom methods can’t be rated');
    await marketRepo.vote(methodId, accountId, { vote: v.vote, stillWorks: v.stillWorks ?? null, difficulty: v.difficulty ?? null });
  },

  // Max: private custom methods (never shown to anyone else)
  async createCustom(accountId: string, name: string, spec: MethodSpec) {
    await entitlementsService.require(accountId, 'mmm.custom');
    if ((await marketRepo.countCustom(accountId)) >= 50) throw new ConflictError('limit_reached', 'Up to 50 custom methods');
    return marketRepo.createCustom(accountId, name, spec);
  },
  async updateCustom(accountId: string, id: string, name: string, spec: MethodSpec) {
    await entitlementsService.require(accountId, 'mmm.custom');
    const r = await marketRepo.updateCustom(accountId, id, name, spec);
    if (!r) throw new NotFoundError('method');
    return r;
  },
  async deleteCustom(accountId: string, id: string) {
    if (!(await marketRepo.deleteCustom(accountId, id))) throw new NotFoundError('method');
  },
};

void logger;
