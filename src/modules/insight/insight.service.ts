import { config } from '../../lib/config.js';
import { ConflictError, ForbiddenError, NotFoundError } from '../../lib/errors.js';
import { normalizeUuid } from '../../lib/ids.js';
import { entitlementsService } from '../entitlements/entitlements.service.js';
import { atLeast, visibleFrom, type Tier } from '../entitlements/tiers.js';
import { cachedPriceBook, marketService } from '../market/market.service.js';
import { skyblockService } from '../skyblock/skyblock.service.js';
import { insightRepo } from './insight.repo.js';
import { classifyActivity, classifyDelta, coinsPerHour, milestones, total } from './insight.js';

const SESSION_GAP_MS = 30 * 60_000;
const DAY = 86_400_000;
const need = (tier: Tier, min: Tier, what: string) => {
  if (!atLeast(tier, min)) throw new ForbiddenError('upgrade_required', `${what} needs SkyStats ${min === 'pro' ? 'Pro' : 'Max'} or above`);
};
/** Clip a requested window to the plan's retention */
const windowFrom = (tier: Tier, days: number) => {
  const wanted = new Date(Date.now() - days * DAY);
  const allowed = visibleFrom(tier);
  return allowed && allowed > wanted ? allowed : wanted;
};

export const insightService = {
  // ------------------------------------------------------------ hooks from the mod
  /** Heartbeat: extend the current play session or start a new one */
  async onHeartbeat(accountId: string) {
    const now = new Date();
    const last = await insightRepo.latestSession(accountId);
    if (last && now.getTime() - last.lastSeenAt.getTime() < SESSION_GAP_MS) await insightRepo.touchSession(last.id, now);
    else await insightRepo.startSession(accountId, now);
  },

  /** Value an inventory the mod sent; only the total is stored */
  async inventoryValue(inv: { id: string; count: number }[] | undefined) {
    if (!inv?.length) return null;
    const book = await cachedPriceBook();
    return inv.reduce((s, i) => s + (book.price(i.id, 'instasell') ?? 0) * i.count, 0);
  },

  /** Kind of this snapshot relative to the last one (transfer / reset / normal) */
  async kindOf(playerUuid: string, profileId: string, cur: { purse: number; personalBank: number | null; profileBank: number | null; skyblockXp: number | null }) {
    const prev = await insightRepo.lastSnapshot(playerUuid, profileId);
    return prev ? classifyDelta(prev, cur).kind : 'normal';
  },

  /** After a snapshot is stored: keep the current session's coins up to date */
  async onSnapshot(accountId: string, profileId: string, coins: number) {
    const s = await insightRepo.latestSession(accountId);
    if (s && Date.now() - s.lastSeenAt.getTime() < SESSION_GAP_MS) await insightRepo.sessionCoins(s.id, profileId, coins, s.coinsStart === null);
  },

  /** Rare drops the mod saw in chat */
  async addEvents(accountId: string, trackingEnabled: boolean, profileId: string | null, events: { type: 'rare_drop'; at: number; itemName: string; itemId?: string; qty?: number }[]) {
    if (!trackingEnabled) throw new ConflictError('tracking_disabled', 'Tracking is turned off for this account');
    const now = Date.now();
    await insightRepo.addEvents(
      events
        .filter((e) => e.at <= now + 60_000 && e.at >= now - DAY)
        .map((e) => ({ accountId, profileId: profileId ? normalizeUuid(profileId) : null, at: new Date(e.at), type: e.type, itemId: e.itemId ?? null, itemName: e.itemName.slice(0, 80), qty: e.qty ?? 1 })),
    );
  },

  /** Worker: label finished sessions for players who turned on activity insights */
  async classifySessions() {
    let n = 0;
    for (const { s } of await insightRepo.unclassified()) {
      const activity = classifyActivity(await insightRepo.eventCategories(s.accountId, s.startedAt, new Date(s.lastSeenAt.getTime() + 60_000))) ?? 'mixed';
      await insightRepo.setActivity(s.id, activity);
      n++;
    }
    return n;
  },

  // ------------------------------------------------------------ dashboard
  async sessions(accountId: string, days: number, insights: boolean) {
    const tier = await entitlementsService.tierOf(accountId);
    const rows = await insightRepo.sessions(accountId, windowFrom(tier, days));
    return rows.map((s) => {
      const ms = s.lastSeenAt.getTime() - s.startedAt.getTime();
      return {
        id: s.id,
        profileId: s.profileId,
        startedAt: s.startedAt,
        endedAt: s.lastSeenAt,
        minutes: Math.round(ms / 60_000),
        coins: s.coinsStart !== null && s.coinsEnd !== null ? s.coinsEnd - s.coinsStart : null,
        coinsPerHour: coinsPerHour(s.coinsStart, s.coinsEnd, ms),
        activity: insights ? s.activity : null,
        methodId: s.methodId,
      };
    });
  },

  async tagSession(accountId: string, id: string, methodId: string | null) {
    if (!(await insightRepo.tagSession(accountId, id, methodId))) throw new NotFoundError('session');
  },

  /** Daily totals for the heatmap and best/worst days (within the plan's retention) */
  async days(accountId: string, playerUuid: string, profileId: string, days: number) {
    const tier = await entitlementsService.tierOf(accountId);
    const from = windowFrom(tier, days).toISOString().slice(0, 10);
    const rows = await insightRepo.days(playerUuid, normalizeUuid(profileId), from);
    const list = rows.map((r) => ({ day: r.day, open: r.openTotal, close: r.closeTotal, change: r.closeTotal !== null && r.openTotal !== null ? r.closeTotal - r.openTotal : null }));
    const ranked = list.filter((d) => d.change !== null).sort((a, b) => b.change! - a.change!);
    return { days: list, best: ranked.slice(0, 5), worst: ranked.slice(-5).reverse(), milestones: milestones(list) };
  },

  /** Pro: income vs spending per day, transfers and resets left out */
  async breakdown(accountId: string, playerUuid: string, profileId: string, days: number) {
    const tier = await entitlementsService.tierOf(accountId);
    need(tier, 'pro', 'Income and spending');
    const snaps = await insightRepo.snapshots(playerUuid, normalizeUuid(profileId), windowFrom(tier, days));
    const byDay = new Map<string, { income: number; spending: number; transfers: number }>();
    for (let i = 1; i < snaps.length; i++) {
      const d = classifyDelta(snaps[i - 1]!, snaps[i]!);
      const k = snaps[i]!.takenAt.toISOString().slice(0, 10);
      const row = byDay.get(k) ?? { income: 0, spending: 0, transfers: 0 };
      if (d.kind === 'transfer') row.transfers++;
      row.income += d.income;
      row.spending += d.spending;
      byDay.set(k, row);
    }
    return { days: [...byDay].map(([day, v]) => ({ day, ...v })) };
  },

  /** Pro: compare two periods of the same length */
  async comparePeriods(accountId: string, playerUuid: string, profileId: string, days: number) {
    const tier = await entitlementsService.tierOf(accountId);
    need(tier, 'pro', 'Period comparison');
    const snaps = await insightRepo.snapshots(playerUuid, normalizeUuid(profileId), windowFrom(tier, days * 2));
    const split = Date.now() - days * DAY;
    const series = (from: number, to: number) => {
      const pts = snaps.filter((s) => s.takenAt.getTime() >= from && s.takenAt.getTime() < to);
      const base = pts[0] ? total(pts[0]) : 0;
      return pts.map((s) => ({ offsetHours: (s.takenAt.getTime() - from) / 3_600_000, change: total(s) - base }));
    };
    return { days, current: series(split, Date.now()), previous: series(split - days * DAY, split) };
  },

  /** Pro: CSV of your history (the JSON data export stays free for everyone) */
  async csv(accountId: string, playerUuid: string, profileId: string) {
    const tier = await entitlementsService.tierOf(accountId);
    need(tier, 'pro', 'CSV export');
    const snaps = await insightRepo.snapshots(playerUuid, normalizeUuid(profileId), visibleFrom(tier));
    const lines = ['taken_at,purse,personal_bank,profile_bank,total,inventory_value,kind'];
    for (const s of snaps) lines.push([s.takenAt.toISOString(), s.purse ?? '', s.personalBank ?? '', s.profileBank ?? '', total(s), s.inventoryValue ?? '', s.kind].join(','));
    return lines.join('\n') + '\n';
  },

  async drops(accountId: string, days: number) {
    const tier = await entitlementsService.tierOf(accountId);
    return { events: await insightRepo.events(accountId, windowFrom(tier, days)) };
  },

  // ------------------------------------------------------------ annotations (Pro)
  async annotations(accountId: string, profileId: string) {
    return { annotations: await insightRepo.annotations(accountId, normalizeUuid(profileId)) };
  },
  async addAnnotation(accountId: string, profileId: string, at: Date, text: string) {
    need(await entitlementsService.tierOf(accountId), 'pro', 'Chart notes');
    if ((await insightRepo.countAnnotations(accountId)) >= 500) throw new ConflictError('limit_reached', 'Up to 500 notes');
    return insightRepo.addAnnotation({ accountId, profileId: normalizeUuid(profileId), at, text: text.slice(0, 120) });
  },
  async deleteAnnotation(accountId: string, id: string) {
    if (!(await insightRepo.deleteAnnotation(accountId, id))) throw new NotFoundError('note');
  },

  // ------------------------------------------------------------ method performance (Pro)
  /** Your real coins/hour on sessions you tagged with a method, vs. its value at today's prices */
  async methodPerformance(accountId: string, methodId: string) {
    need(await entitlementsService.tierOf(accountId), 'pro', 'Method performance');
    const sessions = await insightRepo.taggedSessions(accountId, methodId);
    const rates = sessions.map((s) => coinsPerHour(s.coinsStart, s.coinsEnd, s.lastSeenAt.getTime() - s.startedAt.getTime())).filter((r): r is number => r !== null);
    const method = await marketService.method(accountId, methodId).catch(() => null);
    return {
      methodId,
      sessions: rates.length,
      yourCoinsPerHour: rates.length ? rates.reduce((a, b) => a + b, 0) / rates.length : null,
      expectedPerHour: method && method.unit === 'hour' ? method.value : null,
    };
  },

  // ------------------------------------------------------------ co-op
  /**
   * Co-op view for a profile you're in. Coins only for members who share them (hideBank off);
   * activity only for members who allow it. Members not on SkyStats show what Hypixel shows.
   */
  async coop(accountId: string, playerUuid: string, profileId: string, days: number) {
    const pid = normalizeUuid(profileId);
    const members = await insightRepo.coopMembers(pid);
    if (!members.some((m) => m.uuid === playerUuid && m.active)) throw new NotFoundError('co-op');
    const tier = await entitlementsService.tierOf(accountId);
    const since = windowFrom(tier, days);
    const sharing = members.filter((m) => m.accountId && (m.uuid === playerUuid || m.hideBank === false) && m.trackingEnabled);
    const snaps = await insightRepo.snapshotsOf(sharing.map((m) => m.uuid), pid, since);
    const byMember = new Map<string, typeof snaps>();
    for (const s of snaps) byMember.set(s.playerUuid, [...(byMember.get(s.playerUuid) ?? []), s]);

    const gains = new Map<string, number>();
    const ledger: { uuid: string; at: Date; amount: number }[] = [];
    for (const [uuid, list] of byMember) {
      let gain = 0;
      for (let i = 1; i < list.length; i++) {
        const d = classifyDelta(list[i - 1]!, list[i]!);
        gain += d.income - d.spending;
        // Shared bank ledger: a transfer that moved this member's purse into or out of the co-op bank
        const dCoop = (list[i]!.profileBank ?? 0) - (list[i - 1]!.profileBank ?? 0);
        if (d.kind === 'transfer' && Math.abs(dCoop) > 0) ledger.push({ uuid, at: list[i]!.takenAt, amount: dCoop });
      }
      gains.set(uuid, gain);
    }
    const totalGain = [...gains.values()].filter((g) => g > 0).reduce((a, b) => a + b, 0);
    const feedMembers = members.filter((m) => m.accountId && (m.uuid === playerUuid || m.allowActivityPings));
    const feed = (await insightRepo.sessionsOf(feedMembers.map((m) => m.accountId!), since)).slice(0, 30).map((s) => ({
      uuid: feedMembers.find((m) => m.accountId === s.accountId)!.uuid,
      startedAt: s.startedAt,
      minutes: Math.round((s.lastSeenAt.getTime() - s.startedAt.getTime()) / 60_000),
      coins: (byMember.has(feedMembers.find((m) => m.accountId === s.accountId)!.uuid) && s.coinsStart !== null && s.coinsEnd !== null) ? s.coinsEnd - s.coinsStart : null,
    }));
    const online = (m: (typeof members)[number]) => Boolean(m.modLastSeenAt && Date.now() - m.modLastSeenAt.getTime() < 10 * 60_000 && (m.uuid === playerUuid || m.allowActivityPings));

    return {
      profileId: pid,
      days,
      members: members.map((m) => ({
        uuid: m.uuid,
        username: m.username,
        active: m.active,
        isYou: m.uuid === playerUuid,
        onSkyStats: Boolean(m.accountId),
        sharing: byMember.has(m.uuid),
        online: online(m),
        gain: gains.get(m.uuid) ?? null,
        share: totalGain > 0 && (gains.get(m.uuid) ?? 0) > 0 ? gains.get(m.uuid)! / totalGain : null,
        leftAt: m.active ? null : m.updatedAt,
      })),
      ledger: ledger.sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, 50),
      feed,
      inviteUrl: `${config.PUBLIC_WEB_URL}/link`,
    };
  },

  /** On-demand refresh when someone opens a co-op page (cached; never polled) */
  refreshMembers: (uuid: string) => skyblockService.requestRefresh(uuid),
};

