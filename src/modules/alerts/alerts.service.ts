import { fetchElection } from '../../ingest/hypixel.js';
import { fetchPatchNotes } from '../../ingest/news.js';
import { config } from '../../lib/config.js';
import { AppError, ForbiddenError, NotFoundError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { effectiveTier, hasFeature, type Feature, type Tier } from '../entitlements/tiers.js';
import { entitlementsService } from '../entitlements/entitlements.service.js';
import { alertsRepo, type PrefsRow } from './alerts.repo.js';
import { deliverAfter, localMinutes, manipulationSignal, priceCondition, robustZ, stepRule, type Op } from './rules.js';

const DAY = 86_400_000;
export const RULE_LIMITS: Record<Tier, number> = { free: 0, pro: 25, max: 200 };
const KIND_FEATURE: Record<string, Feature> = { price: 'alerts.price', anomaly: 'alerts.anomaly', manipulation: 'alerts.manipulation' };

const DEFAULT_PREFS: Omit<PrefsRow, 'accountId' | 'updatedAt'> = {
  discordDm: false,
  quietStartMin: null,
  quietEndMin: null,
  timeZone: 'Europe/London',
  dailyDigest: false,
  weeklyRecap: false,
  coopActivity: false,
  mayorReminder: false,
  patchNotes: false,
  outages: false,
};

const fmt = (n: number) => {
  const a = Math.abs(n);
  const [d, s] = a >= 1e9 ? [1e9, 'B'] : a >= 1e6 ? [1e6, 'M'] : a >= 1e3 ? [1e3, 'k'] : [1, ''];
  return `${Number((n / d).toFixed(a / d >= 100 ? 0 : 1))}${s}`;
};
const itemName = (id: string) => id.toLowerCase().replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
const tierOf = (r: { tier: string | null; status: string | null; currentPeriodEnd: Date | null; graceUntil: Date | null }) =>
  r.tier ? effectiveTier({ tier: r.tier, status: r.status ?? 'none', currentPeriodEnd: r.currentPeriodEnd, graceUntil: r.graceUntil }) : 'free';

export const alertsService = {
  // ---------------------------------------------------------------- delivery
  /** Every alert goes through here: respects quiet hours, DMs only if opted in and Discord is linked. */
  async notify(accountId: string, n: { kind: string; title: string; body: string; url?: string; dedupeKey?: string }) {
    const p = { ...DEFAULT_PREFS, ...(await alertsRepo.prefs(accountId)) };
    const dm = p.discordDm && (await alertsRepo.hasDiscord(accountId));
    return alertsRepo.insertNotification({
      accountId,
      kind: n.kind,
      title: n.title,
      body: n.body,
      url: n.url ?? null,
      dedupeKey: n.dedupeKey ?? null,
      deliverAfter: deliverAfter(new Date(), { start: p.quietStartMin, end: p.quietEndMin, timeZone: p.timeZone }),
      dmStatus: dm ? 'pending' : 'none',
    });
  },

  // ---------------------------------------------------------------- prefs
  async prefs(accountId: string) {
    const p = await alertsRepo.prefs(accountId);
    const { accountId: _a, updatedAt: _u, ...rest } = { ...DEFAULT_PREFS, ...p, accountId, updatedAt: null };
    return rest;
  },
  async updatePrefs(accountId: string, set: Partial<typeof DEFAULT_PREFS>) {
    if (set.timeZone) {
      try {
        new Intl.DateTimeFormat('en-GB', { timeZone: set.timeZone });
      } catch {
        throw new AppError(400, 'bad_request', 'Unknown time zone');
      }
    }
    // Pro-only digests: refuse turning them on without the plan (outage and patch notices are free)
    const tier = await entitlementsService.tierOf(accountId);
    const proOnly: [keyof typeof set, Feature][] = [
      ['dailyDigest', 'alerts.daily_digest'],
      ['weeklyRecap', 'alerts.weekly_recap'],
      ['coopActivity', 'alerts.coop_activity'],
      ['mayorReminder', 'alerts.mayor_reminder'],
      ['quietStartMin', 'alerts.quiet_hours'],
    ];
    for (const [k, f] of proOnly) if (set[k] && !hasFeature(tier, f)) throw new ForbiddenError('upgrade_required', 'This alert needs Pro or Max');
    await alertsRepo.savePrefs(accountId, set);
    return this.prefs(accountId);
  },

  // ---------------------------------------------------------------- rules
  listRules: (accountId: string) => alertsRepo.listRules(accountId),

  async createRule(accountId: string, r: { kind: 'price' | 'anomaly' | 'manipulation'; productId: string; side: 'buy' | 'sell'; op?: Op; threshold?: number; cooldownMinutes: number }) {
    const tier = await entitlementsService.require(accountId, KIND_FEATURE[r.kind]!);
    if ((await alertsRepo.countRules(accountId)) >= RULE_LIMITS[tier]) {
      throw new AppError(409, 'limit_reached', `Your plan allows ${RULE_LIMITS[tier]} alerts`);
    }
    if (!(await alertsRepo.productExists(r.productId))) throw new NotFoundError('bazaar item');
    if (r.kind === 'price' && (!r.op || r.threshold === undefined)) throw new AppError(400, 'bad_request', 'Price alerts need op and threshold');
    return alertsRepo.createRule({
      accountId,
      kind: r.kind,
      productId: r.productId,
      side: r.side,
      op: r.kind === 'price' ? r.op : null,
      threshold: r.kind === 'anomaly' ? (r.threshold ?? 4) : (r.threshold ?? null),
      cooldownMinutes: r.cooldownMinutes,
    });
  },

  async deleteRule(accountId: string, id: string) {
    if (!(await alertsRepo.deleteRule(accountId, id))) throw new NotFoundError('alert');
  },

  /** Worker (every minute): price crossings */
  async evaluatePrices() {
    const rows = (await alertsRepo.activeRules('price')).filter((r) => hasFeature(tierOf(r), 'alerts.price'));
    const prices = new Map((await alertsRepo.latestPrices([...new Set(rows.map((r) => r.rule.productId))])).map((p) => [p.productId, p]));
    let fired = 0;
    for (const { rule } of rows) {
      const p = prices.get(rule.productId);
      if (!p || !rule.op || rule.threshold === null) continue;
      const price = rule.side === 'sell' ? p.sellPrice : p.buyPrice;
      const step = stepRule(rule, priceCondition(rule.op as Op, rule.threshold, price));
      if (step.fire) {
        fired++;
        await this.notify(rule.accountId, {
          kind: 'price',
          title: `${itemName(rule.productId)} is ${rule.op} ${fmt(rule.threshold)}`,
          body: `${rule.side === 'sell' ? 'Instasell' : 'Instabuy'} price is now ${fmt(price)} coins.`,
          url: `${config.PUBLIC_WEB_URL}/bazaar/${rule.productId}`,
        });
      }
      if (step.fire || step.armed !== rule.armed) await alertsRepo.updateRuleState(rule.id, { armed: step.armed, ...(step.fire ? { lastFiredAt: new Date() } : {}) });
    }
    return fired;
  },

  /** Worker (every 10 minutes): unusual price moves and order walls */
  async evaluateMarket() {
    const rows = [...(await alertsRepo.activeRules('anomaly')), ...(await alertsRepo.activeRules('manipulation'))].filter((r) =>
      hasFeature(tierOf(r), KIND_FEATURE[r.rule.kind]!),
    );
    const ids = [...new Set(rows.map((r) => r.rule.productId))];
    const latest = new Map((await alertsRepo.latestPrices(ids)).map((p) => [p.productId, p]));
    const hist = new Map<string, Awaited<ReturnType<typeof alertsRepo.snapshotsSince>>>();
    for (const s of await alertsRepo.snapshotsSince(ids, new Date(Date.now() - 7 * DAY))) {
      hist.set(s.productId, [...(hist.get(s.productId) ?? []), s]);
    }
    let fired = 0;
    for (const { rule } of rows) {
      const now = latest.get(rule.productId);
      const h = hist.get(rule.productId) ?? [];
      if (!now) continue;
      let message: string | null = null;
      if (rule.kind === 'anomaly') {
        const price = rule.side === 'sell' ? now.sellPrice : now.buyPrice;
        const z = robustZ(h.map((s) => (rule.side === 'sell' ? s.sellPrice : s.buyPrice)), price);
        if (z !== null && Math.abs(z) >= (rule.threshold ?? 4)) message = `Price ${z > 0 ? 'jumped' : 'dropped'} to ${fmt(price)}, far outside its usual 7-day range.`;
      } else {
        const signal = manipulationSignal(h, now);
        if (signal) message = `Possible market manipulation: ${signal}. Be careful trading it right now.`;
      }
      const step = stepRule(rule, message !== null);
      if (step.fire && message) {
        fired++;
        await this.notify(rule.accountId, {
          kind: rule.kind,
          title: `${itemName(rule.productId)}: ${rule.kind === 'anomaly' ? 'unusual move' : 'possible manipulation'}`,
          body: message,
          url: `${config.PUBLIC_WEB_URL}/bazaar/${rule.productId}`,
        });
      }
      if (step.fire || step.armed !== rule.armed) await alertsRepo.updateRuleState(rule.id, { armed: step.armed, ...(step.fire ? { lastFiredAt: new Date() } : {}) });
    }
    return fired;
  },

  // ---------------------------------------------------------------- goals
  listGoals: (accountId: string) => alertsRepo.listGoals(accountId),
  createGoal: (accountId: string, profileId: string, target: number) => alertsRepo.createGoal(accountId, profileId, target),
  async deleteGoal(accountId: string, id: string) {
    if (!(await alertsRepo.deleteGoal(accountId, id))) throw new NotFoundError('goal');
  },
  /** Called after a mod snapshot is stored. Goals are free; the alert is Pro and above. */
  async checkGoals(accountId: string, profileId: string, total: number) {
    const reached = await alertsRepo.reachGoals(accountId, profileId, total);
    if (reached.length === 0) return;
    if (!hasFeature(await entitlementsService.tierOf(accountId), 'alerts.goal_reached')) return;
    for (const g of reached) {
      await this.notify(accountId, {
        kind: 'goal',
        title: `Goal reached: ${fmt(g.target)} coins`,
        body: `You hit your goal of ${fmt(g.target)} coins. Nice grinding!`,
        url: `${config.PUBLIC_WEB_URL}/me`,
        dedupeKey: `goal:${g.id}`,
      });
    }
  },

  // ---------------------------------------------------------------- co-op activity
  /** A player started a session: tell co-op mates who asked, if the player allows it. */
  async coopSessionStarted(playerUuid: string, allowActivityPings: boolean) {
    if (!allowActivityPings) return;
    const name = (await alertsRepo.username(playerUuid)) ?? 'A co-op member';
    const subs = new Set((await alertsRepo.prefsWhere('coopActivity')).filter((r) => hasFeature(tierOf(r), 'alerts.coop_activity')).map((r) => r.prefs.accountId));
    const hour = new Date().toISOString().slice(0, 13);
    for (const mate of await alertsRepo.coopMates(playerUuid)) {
      if (!subs.has(mate.accountId)) continue;
      await this.notify(mate.accountId, { kind: 'coop', title: `${name} is online`, body: `${name} started playing SkyBlock.`, dedupeKey: `coop:${playerUuid}:${hour}` });
    }
  },

  // ---------------------------------------------------------------- digests
  /** Worker (hourly): daily digest at 08:00 and weekly recap on Monday 09:00, local time */
  async digests(now = new Date()) {
    const yesterday = new Date(now.getTime() - DAY).toISOString().slice(0, 10);
    const weekAgo = new Date(now.getTime() - 7 * DAY).toISOString().slice(0, 10);
    let sent = 0;
    const movers = await alertsRepo.movers(new Date(now.getTime() - DAY));
    const moverText = movers.map((m) => `${itemName(m.productId)} ${m.now >= m.then ? '+' : ''}${(((m.now - m.then) / m.then) * 100).toFixed(1)}%`).join(', ');

    for (const r of await alertsRepo.prefsWhere('dailyDigest')) {
      if (!hasFeature(tierOf(r), 'alerts.daily_digest') || Math.floor(localMinutes(now, r.prefs.timeZone) / 60) !== 8) continue;
      const change = await alertsRepo.dailyChange(r.playerUuid, yesterday, yesterday);
      const ok = await this.notify(r.prefs.accountId, {
        kind: 'digest',
        title: 'Your SkyStats morning digest',
        body: [change === null ? 'No coins recorded yesterday.' : `Yesterday: ${change >= 0 ? '+' : ''}${fmt(change)} coins.`, moverText && `Bazaar movers: ${moverText}.`].filter(Boolean).join(' '),
        url: `${config.PUBLIC_WEB_URL}/me`,
        dedupeKey: `digest:${yesterday}`,
      });
      if (ok) sent++;
    }
    for (const r of await alertsRepo.prefsWhere('weeklyRecap')) {
      const local = new Intl.DateTimeFormat('en-GB', { timeZone: r.prefs.timeZone, weekday: 'short' }).format(now);
      if (!hasFeature(tierOf(r), 'alerts.weekly_recap') || local !== 'Mon' || Math.floor(localMinutes(now, r.prefs.timeZone) / 60) !== 9) continue;
      const change = await alertsRepo.dailyChange(r.playerUuid, weekAgo, yesterday);
      const ok = await this.notify(r.prefs.accountId, {
        kind: 'recap',
        title: 'Your week on SkyStats',
        body: change === null ? 'No coins recorded last week.' : `Last 7 days: ${change >= 0 ? '+' : ''}${fmt(change)} coins.`,
        url: `${config.PUBLIC_WEB_URL}/me`,
        dedupeKey: `recap:${weekAgo}`,
      });
      if (ok) sent++;
    }
    return sent;
  },

  // ---------------------------------------------------------------- free notices
  /** Worker (every 15 min): new patch notes → free notice for opted-in users; the bot posts them to channels. */
  async pollNews() {
    const fresh = await alertsRepo.upsertNews(await fetchPatchNotes());
    if (fresh.length === 0) return 0;
    const subs = await alertsRepo.prefsWhere('patchNotes');
    for (const item of fresh) {
      for (const r of subs) {
        await this.notify(r.prefs.accountId, { kind: 'patch', title: 'New SkyBlock update', body: item.title, url: item.id, dedupeKey: `patch:${item.id}` });
      }
    }
    return fresh.length;
  },

  /** Called by the status poller when SkyBlock goes down or recovers (free, opt-in). */
  async outageChanged(down: boolean, description: string) {
    const stamp = new Date().toISOString().slice(0, 16);
    for (const r of await alertsRepo.prefsWhere('outages')) {
      await this.notify(r.prefs.accountId, {
        kind: 'outage',
        title: down ? 'SkyBlock is having problems' : 'SkyBlock is back',
        body: description,
        url: 'https://status.hypixel.net',
        dedupeKey: `outage:${down}:${stamp}`,
      });
    }
  },

  /** Worker (hourly): mayor and election. Reminds opted-in Pro users when voting opens. */
  async pollElection() {
    const e = await fetchElection();
    const before = await alertsRepo.election();
    const open = Boolean(e.current);
    await alertsRepo.saveElection({
      year: e.current?.year ?? before?.year ?? null,
      mayor: e.mayor?.name ?? null,
      perks: e.mayor?.perks ?? [],
      candidates: e.current?.candidates ?? [],
      open,
      checkedAt: new Date(),
    });
    if (!open || before?.open) return 0;
    const names = (e.current?.candidates ?? []).map((c) => c.name).join(', ');
    let sent = 0;
    for (const r of await alertsRepo.prefsWhere('mayorReminder')) {
      if (!hasFeature(tierOf(r), 'alerts.mayor_reminder')) continue;
      if (await this.notify(r.prefs.accountId, { kind: 'mayor', title: 'SkyBlock election is open', body: `Candidates: ${names}. Vote in the Community Center.`, dedupeKey: `election:${e.current!.year}` })) sent++;
    }
    return sent;
  },

  async election() {
    return alertsRepo.election();
  },
  listNews: () => alertsRepo.listNews(),

  // ---------------------------------------------------------------- inbox & bot
  listNotifications: (accountId: string) => alertsRepo.listNotifications(accountId),
  markAllRead: (accountId: string) => alertsRepo.markAllRead(accountId),
  claimDue: (limit: number) => alertsRepo.claimDue(limit),
  setDmStatus: (id: number, ok: boolean) => alertsRepo.setDmStatus(id, ok ? 'sent' : 'failed'),
  unannouncedNews: () => alertsRepo.unannouncedNews(),
  markAnnounced: (id: string) => alertsRepo.markAnnounced(id),
  maintenance: () => alertsRepo.maintenance(),
};

void logger;
