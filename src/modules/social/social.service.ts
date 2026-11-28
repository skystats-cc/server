import { config } from '../../lib/config.js';
import { AppError, ConflictError, ForbiddenError, NotFoundError } from '../../lib/errors.js';
import { audit } from '../audit/audit.repo.js';
import { alertsService } from '../alerts/alerts.service.js';
import { entitlementsService } from '../entitlements/entitlements.service.js';
import { atLeast, effectiveTier, visibleFrom } from '../entitlements/tiers.js';
import { marketRepo } from '../market/market.repo.js';
import { ACHIEVEMENTS, consistency, earnedAchievements, guessPoints, longestStreak, pickForDay, predictionPoints, type AchievementKey } from './rules.js';
import { socialRepo } from './social.repo.js';

const DAY = 86_400_000;
const today = () => new Date().toISOString().slice(0, 10);
export const THEMES = ['gold', 'emerald', 'sapphire', 'amethyst', 'ruby', 'obsidian'] as const;
const VANITY = /^[a-z0-9][a-z0-9-]{2,23}$/;

export const socialService = {
  // ------------------------------------------------------------ leaderboards (opt-in)
  /** Worker (15 min): materialise boards for players with showOnLeaderboards on */
  async computeBoards() {
    const now = new Date();
    const rows: Parameters<typeof socialRepo.replaceBoards>[0] = [];
    for (const [period, days] of [['7d', 7], ['30d', 30]] as const) {
      const g = await socialRepo.gains(new Date(Date.now() - days * DAY).toISOString().slice(0, 10));
      const push = (board: string, scope: string, list: { subject: string; value: number; label: string }[]) =>
        list
          .sort((a, b) => b.value - a.value)
          .slice(0, 500)
          .forEach((e, i) => rows.push({ board, period, scope, subject: e.subject, rank: i + 1, value: e.value, label: e.label, computedAt: now }));

      // Per player (all profiles), and per game mode
      const byAccount = new Map<string, { label: string; gain: number; days: number; up: number }>();
      const byMode = new Map<string, Map<string, { label: string; gain: number }>>();
      for (const r of g) {
        const a = byAccount.get(r.accountId) ?? { label: r.label ?? '?', gain: 0, days: 0, up: 0 };
        a.gain += r.gain;
        a.days = Math.max(a.days, r.days);
        a.up = Math.max(a.up, r.upDays);
        byAccount.set(r.accountId, a);
        const mode = r.gameMode ?? 'normal';
        if (!byMode.has(mode)) byMode.set(mode, new Map());
        const m = byMode.get(mode)!.get(r.accountId) ?? { label: r.label ?? '?', gain: 0 };
        m.gain += r.gain;
        byMode.get(mode)!.set(r.accountId, m);
      }
      push('gain', 'global', [...byAccount].map(([subject, v]) => ({ subject, value: v.gain, label: v.label })));
      push('consistency', 'global', [...byAccount].filter(([, v]) => v.days >= Math.min(3, days)).map(([subject, v]) => ({ subject, value: v.up / v.days, label: v.label })));
      for (const [mode, m] of byMode) push('gain', `mode:${mode}`, [...m].map(([subject, v]) => ({ subject, value: v.gain, label: v.label })));

      // Co-ops: only opted-in members count; labelled by profile name
      const coops = new Map<string, { label: string; gain: number }>();
      for (const r of g) {
        const c = coops.get(r.profileId) ?? { label: r.profileName ?? 'Co-op', gain: 0 };
        c.gain += r.gain;
        coops.set(r.profileId, c);
      }
      push('coop', 'global', [...coops].map(([subject, v]) => ({ subject, value: v.gain, label: v.label })));
    }
    await socialRepo.replaceBoards(rows);
    return rows.length;
  },

  async leaderboard(board: string, period: string, scope: string, accountId: string | null) {
    const entries = await socialRepo.board(board, period, scope);
    const you = accountId ? (await socialRepo.boardFor(board, period, scope, [accountId]))[0] ?? null : null;
    return { board, period, scope, entries: entries.map(({ rank, label, value, subject }) => ({ rank, label, value, isYou: subject === accountId })), you: you ? { rank: you.rank, value: you.value } : null };
  },

  /** Bot: a Discord server's own board, from members who opted in */
  async serverLeaderboard(discordIds: string[], board: string, period: string) {
    const links = await socialRepo.accountsForDiscord(discordIds.slice(0, 5000));
    const rows = await socialRepo.boardFor(board, period, 'global', [...new Set(links.map((l) => l.accountId))]);
    return { entries: rows.slice(0, 25).map((r, i) => ({ rank: i + 1, label: r.label, value: r.value })) };
  },

  // ------------------------------------------------------------ follows (public profiles only)
  async follow(accountId: string, name: string) {
    const target = await socialRepo.publicAccountByName(name);
    if (!target) throw new NotFoundError('public profile');
    if (target.id === accountId) throw new AppError(400, 'bad_request', 'You can’t follow yourself');
    if ((await socialRepo.countFollowing(accountId)) >= 200) throw new ConflictError('limit_reached', 'You can follow up to 200 players');
    await socialRepo.follow(accountId, target.id);
  },
  async unfollow(accountId: string, name: string) {
    const target = await socialRepo.publicAccountByName(name);
    if (target) await socialRepo.unfollow(accountId, target.id);
  },
  following: async (accountId: string) => ({ following: await socialRepo.following(accountId) }),
  async feed(accountId: string) {
    const rows = await socialRepo.feed(accountId, new Date(Date.now() - 30 * DAY));
    return {
      items: rows
        .filter((r) => r.key !== 'supporter' || r.showTierRole)
        .map((r) => ({ uuid: r.uuid, username: r.username, achievement: r.key, name: ACHIEVEMENTS[r.key as AchievementKey]?.name ?? r.key, earnedAt: r.earnedAt })),
    };
  },

  // ------------------------------------------------------------ achievements
  /** Worker (hourly): award achievements; Pro+ with goal alerts on get a notification */
  async awardAchievements() {
    let granted = 0;
    for (const a of await socialRepo.achievementInputs()) {
      const tier = a.tier
        ? effectiveTier({ tier: a.tier, status: a.status ?? 'none', currentPeriodEnd: a.currentPeriodEnd ? new Date(a.currentPeriodEnd) : null, graceUntil: a.graceUntil ? new Date(a.graceUntil) : null })
        : 'free';
      const keys = earnedAchievements({
        maxTotal: a.maxTotal ?? 0,
        sessions: a.sessions,
        longestStreak: longestStreak(await socialRepo.dailyChanges(a.uuid)),
        createdAt: new Date(a.createdAt),
        paid: tier !== 'free',
      });
      const fresh = await socialRepo.grant(a.accountId, keys);
      granted += fresh.length;
      for (const f of fresh) {
        const def = ACHIEVEMENTS[f.key as AchievementKey];
        if (def && atLeast(tier, 'pro')) {
          await alertsService.notify(a.accountId, { kind: 'achievement', title: `Achievement: ${def.name}`, body: def.description, url: `${config.PUBLIC_WEB_URL}/me`, dedupeKey: `ach:${f.key}` });
        }
      }
    }
    return granted;
  },
  async achievements(accountId: string) {
    const got = new Map((await socialRepo.achievementsOf(accountId)).map((a) => [a.key, a.earnedAt]));
    return { achievements: (Object.keys(ACHIEVEMENTS) as AchievementKey[]).map((k) => ({ key: k, ...ACHIEVEMENTS[k], earnedAt: got.get(k) ?? null })) };
  },
  /** Badges for a public profile: supporter only when the player shows their plan */
  async publicBadges(accountId: string, showTierRole: boolean) {
    return (await socialRepo.achievementsOf(accountId)).filter((a) => a.key !== 'supporter' || showTierRole).map((a) => ({ key: a.key, name: ACHIEVEMENTS[a.key as AchievementKey]?.name ?? a.key }));
  },

  // ------------------------------------------------------------ wrapped
  /** Your year (YYYY) or month (YYYY-MM), clipped to what your plan keeps */
  async wrapped(accountId: string, uuid: string, period: string) {
    const m = period.match(/^(\d{4})(?:-(\d{2}))?$/);
    if (!m) throw new AppError(400, 'bad_request', 'Use YYYY or YYYY-MM');
    const from = new Date(Date.UTC(Number(m[1]), m[2] ? Number(m[2]) - 1 : 0, 1));
    const to = m[2] ? new Date(Date.UTC(Number(m[1]), Number(m[2]), 1)) : new Date(Date.UTC(Number(m[1]) + 1, 0, 1));
    const allowed = visibleFrom(await entitlementsService.tierOf(accountId));
    const start = allowed && allowed > from ? allowed : from;
    const { days, sessions, drops, earned } = await socialRepo.wrappedData(accountId, uuid, start, to);
    const ranked = [...days].sort((a, b) => b.change - a.change);
    const minutes = sessions.reduce((s, x) => s + (x.lastSeenAt.getTime() - x.startedAt.getTime()) / 60_000, 0);
    const acts = new Map<string, number>();
    for (const s of sessions) if (s.activity && s.activity !== 'mixed') acts.set(s.activity, (acts.get(s.activity) ?? 0) + 1);
    return {
      period,
      from: start,
      to,
      clippedByPlan: start > from,
      coinsGained: days.reduce((s, d) => s + d.change, 0),
      bestDay: ranked[0] ? { day: ranked[0].day, change: ranked[0].change } : null,
      daysPlayed: days.length,
      consistency: consistency(days),
      longestStreak: longestStreak([...days].sort((a, b) => a.day.localeCompare(b.day))),
      sessions: sessions.length,
      hoursPlayed: Math.round(minutes / 60),
      topActivity: [...acts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null,
      topDrops: drops.map((d) => ({ name: d.name, count: d.n })),
      achievements: earned.map((e) => ACHIEVEMENTS[e.key as AchievementKey]?.name ?? e.key),
    };
  },

  // ------------------------------------------------------------ competitions (bot)
  async createCompetition(guildId: string, discordId: string, name: string, hours: number) {
    const startsAt = new Date();
    return socialRepo.createCompetition({ guildId, name: name.slice(0, 60), startsAt, endsAt: new Date(startsAt.getTime() + hours * 3_600_000), createdByDiscord: discordId });
  },
  listCompetitions: async (guildId: string) => ({ competitions: await socialRepo.activeCompetitions(guildId) }),
  async joinCompetition(id: string, accountId: string) {
    const c = await socialRepo.competition(id);
    if (!c) throw new NotFoundError('competition');
    if (c.endsAt < new Date()) throw new ConflictError('ended', 'That competition has ended');
    await socialRepo.join(id, accountId);
    await audit.log('user', 'competition.joined', accountId, { competitionId: id });
  },
  async standings(id: string) {
    const c = await socialRepo.competition(id);
    if (!c) throw new NotFoundError('competition');
    return { competition: c, standings: await socialRepo.standings(c) };
  },

  // ------------------------------------------------------------ games (bot, no stakes, no prizes)
  async todaysRound(game: 'guess' | 'predict') {
    const day = today();
    const existing = await socialRepo.round(game, day);
    if (existing) return existing;
    const ids = (await marketRepo.topByVolume(100)).map((r) => r.id);
    const pick = pickForDay(ids, day, game);
    if (!pick) throw new AppError(503, 'unavailable', 'No bazaar data yet');
    const p = await marketRepo.product(pick);
    return socialRepo.createRound({ game, day, productId: pick, startPrice: p!.buyPrice });
  },
  async playGuess(discordId: string, guess: number) {
    const r = await this.todaysRound('guess');
    const actual = (await marketRepo.product(r.productId))?.buyPrice ?? r.startPrice;
    const points = guessPoints(guess, actual);
    if (!(await socialRepo.play({ game: 'guess', day: r.day, discordId, answer: guess, points }))) throw new ConflictError('already_played', 'You’ve already guessed today');
    return { productId: r.productId, actual, points };
  },
  async playPredict(discordId: string, direction: 1 | -1) {
    const r = await this.todaysRound('predict');
    if (!(await socialRepo.play({ game: 'predict', day: r.day, discordId, answer: direction }))) throw new ConflictError('already_played', 'You’ve already predicted today');
    return { productId: r.productId, startPrice: r.startPrice, resolvesAt: new Date(Date.parse(r.day) + 2 * DAY) };
  },
  /** Worker (hourly): score yesterday's predictions; drop plays older than 30 days */
  async resolvePredictions() {
    let n = 0;
    for (const r of await socialRepo.unresolvedPredictions(today())) {
      const end = (await marketRepo.product(r.productId))?.buyPrice;
      if (end === undefined) continue;
      await socialRepo.resolveRound(r.day, end);
      for (const p of await socialRepo.playsFor('predict', r.day)) {
        await socialRepo.setPoints('predict', r.day, p.discordId, predictionPoints(p.answer, r.startPrice, end));
        n++;
      }
    }
    await socialRepo.cleanupGames(new Date(Date.now() - 30 * DAY).toISOString().slice(0, 10));
    return n;
  },
  gameBoard: async (game: 'guess' | 'predict') => ({ entries: await socialRepo.gameBoard(game, new Date(Date.now() - 30 * DAY).toISOString().slice(0, 10)) }),
  /** Two random players who chose to show their coins publicly */
  async richOrNot() {
    const c = (await socialRepo.richCandidates()).filter((x) => x.total !== null);
    if (c.length < 2) throw new AppError(503, 'unavailable', 'Not enough public profiles yet');
    const i = Math.floor(Math.random() * c.length);
    let j = Math.floor(Math.random() * (c.length - 1));
    if (j >= i) j++;
    return { a: c[i]!, b: c[j]! };
  },

  // ------------------------------------------------------------ public profile look
  async look(accountId: string) {
    return { ...(await socialRepo.look(accountId)), themes: THEMES };
  },
  async setLook(accountId: string, set: { profileTheme?: string | null; vanity?: string | null }) {
    const tier = await entitlementsService.tierOf(accountId);
    if (set.profileTheme !== undefined) {
      if (set.profileTheme !== null && !atLeast(tier, 'pro')) throw new ForbiddenError('upgrade_required', 'Profile themes need SkyStats Pro or above');
      if (set.profileTheme !== null && !(THEMES as readonly string[]).includes(set.profileTheme)) throw new AppError(400, 'bad_request', 'Unknown theme');
    }
    if (set.vanity !== undefined && set.vanity !== null) {
      if (tier !== 'max') throw new ForbiddenError('upgrade_required', 'A custom profile link needs SkyStats Max');
      set.vanity = set.vanity.toLowerCase();
      if (!VANITY.test(set.vanity)) throw new AppError(400, 'bad_request', '3-24 letters, numbers or dashes');
      if (await socialRepo.vanityTaken(set.vanity, accountId)) throw new ConflictError('taken', 'That link is taken');
    }
    await socialRepo.setLook(accountId, set);
    return this.look(accountId);
  },
};
