import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { requireAuth, requireBot } from '../../http/auth.js';
import { config } from '../../lib/config.js';
import { marketRepo } from '../market/market.repo.js';
import { playersService } from '../players/players.service.js';
import { ogPage, shareCard } from './og.js';
import { socialService, THEMES } from './social.service.js';

const both = requireAuth(['web', 'bot']);
const name = z.object({ name: z.string().regex(/^[A-Za-z0-9_-]{1,24}$/) });
const boardQ = z.object({
  board: z.enum(['gain', 'consistency', 'coop']).default('gain'),
  period: z.enum(['7d', '30d']).default('7d'),
  scope: z.string().regex(/^(global|mode:[a-z_]{1,20})$/).default('global'),
});
const fmt = (n: number) => (Math.abs(n) >= 1e9 ? `${(n / 1e9).toFixed(1)}B` : Math.abs(n) >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : Math.abs(n) >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : n.toFixed(0));

export const socialRoutes: FastifyPluginAsync = async (app) => {
  // ---- leaderboards (public, opt-in players only) ----
  app.get('/v1/leaderboards', async (req, reply) => {
    const q = boardQ.parse(req.query);
    reply.header('cache-control', req.auth ? 'private, max-age=60' : 'public, max-age=120');
    return socialService.leaderboard(q.board, q.period, q.scope, req.auth?.accountId ?? null);
  });

  // ---- follows & feed ----
  app.get('/v1/me/follows', { preHandler: both }, async (req) => socialService.following(req.auth!.accountId));
  app.put('/v1/me/follows/:name', { preHandler: both }, async (req, reply) => {
    await socialService.follow(req.auth!.accountId, name.parse(req.params).name);
    return reply.code(204).send();
  });
  app.delete('/v1/me/follows/:name', { preHandler: both }, async (req, reply) => {
    await socialService.unfollow(req.auth!.accountId, name.parse(req.params).name);
    return reply.code(204).send();
  });
  app.get('/v1/me/feed', { preHandler: both }, async (req) => socialService.feed(req.auth!.accountId));

  // ---- achievements & wrapped ----
  app.get('/v1/me/achievements', { preHandler: both }, async (req) => socialService.achievements(req.auth!.accountId));
  app.get('/v1/me/wrapped', { preHandler: both }, async (req) => {
    const { period } = z.object({ period: z.string().regex(/^\d{4}(-\d{2})?$/).default(String(new Date().getUTCFullYear())) }).parse(req.query);
    return socialService.wrapped(req.auth!.accountId, req.auth!.playerUuid, period);
  });

  // ---- public profile look ----
  app.get('/v1/me/profile-look', { preHandler: both }, async (req) => socialService.look(req.auth!.accountId));
  app.patch('/v1/me/profile-look', { preHandler: requireAuth('web') }, async (req) => {
    const body = z.object({ profileTheme: z.enum(THEMES).nullable().optional(), vanity: z.string().max(24).nullable().optional() }).strict().parse(req.body ?? {});
    return socialService.setLook(req.auth!.accountId, body);
  });

  // ---- share images and crawler pages ----
  app.get('/v1/og/player/:file', async (req, reply) => {
    const { file } = z.object({ file: z.string().regex(/^[A-Za-z0-9_-]{1,24}\.png$/) }).parse(req.params);
    const p = await playersService.publicSummary(file.slice(0, -4)).catch(() => null);
    const sel = p?.profiles[0];
    const png = p
      ? shareCard(p.username, sel ? `${sel.name ?? 'Profile'} · SkyBlock level ${sel.skyblockLevel ?? '?'}` : 'SkyBlock profile', sel?.total != null ? fmt(sel.total) : `${p.profiles.length}`, sel?.total != null ? 'coins' : 'profiles')
      : shareCard('SkyStats.cc', 'Hypixel SkyBlock money tracking', '', '');
    return reply.headers({ 'content-type': 'image/png', 'cache-control': 'public, max-age=600' }).send(png);
  });
  app.get('/v1/og/bazaar/:file', async (req, reply) => {
    const { file } = z.object({ file: z.string().regex(/^[A-Za-z0-9_:-]{1,64}\.png$/) }).parse(req.params);
    const p = await marketRepo.product(file.slice(0, -4).toUpperCase());
    const label = file.slice(0, -4).toLowerCase().replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    const png = shareCard(label, 'Bazaar price', p ? fmt(p.buyPrice) : '—', 'coins to instabuy');
    return reply.headers({ 'content-type': 'image/png', 'cache-control': 'public, max-age=300' }).send(png);
  });
  // Caddy sends link-preview bots here for /p/* and /bazaar/*
  app.get('/v1/og/page/*', async (req, reply) => {
    const path = '/' + (req.params as { '*': string })['*'];
    const site = config.PUBLIC_WEB_URL.replace(/\/$/, '');
    const api = `${site}/v1`;
    let meta = { title: 'SkyStats.cc', description: 'Hypixel SkyBlock money tracking, bazaar prices and money-making methods.', image: `${api}/og/player/_.png`, url: site + path };
    const p = path.match(/^\/p\/([A-Za-z0-9_-]{1,24})$/);
    const b = path.match(/^\/bazaar\/([A-Za-z0-9_:-]{1,64})$/);
    if (p) meta = { ...meta, title: `${p[1]} on SkyStats`, description: 'SkyBlock profile and coins over time.', image: `${api}/og/player/${p[1]}.png` };
    if (b) meta = { ...meta, title: `${b[1]} bazaar price`, description: 'Live price, history and insight.', image: `${api}/og/bazaar/${b[1]}.png` };
    return reply.headers({ 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=300' }).send(ogPage(meta));
  });

  // ---- bot: server leaderboards, competitions, games ----
  app.post('/v1/bot/leaderboard', { preHandler: requireBot }, async (req) => {
    const b = z.object({ discordIds: z.array(z.string().regex(/^\d{17,20}$/)).max(5000), board: z.enum(['gain', 'consistency']).default('gain'), period: z.enum(['7d', '30d']).default('7d') }).parse(req.body ?? {});
    return socialService.serverLeaderboard(b.discordIds, b.board, b.period);
  });
  app.post('/v1/bot/competitions', { preHandler: requireBot }, async (req, reply) => {
    const b = z.object({ guildId: z.string().regex(/^\d{17,20}$/), name: z.string().min(1).max(60), hours: z.number().int().min(1).max(24 * 14) }).strict().parse(req.body ?? {});
    return reply.code(201).send(await socialService.createCompetition(b.guildId, req.bot!.discordUserId, b.name, b.hours));
  });
  app.get('/v1/bot/competitions', { preHandler: requireBot }, async (req) => socialService.listCompetitions(z.object({ guildId: z.string().regex(/^\d{17,20}$/) }).parse(req.query).guildId));
  app.post('/v1/bot/competitions/:id/join', { preHandler: requireAuth('bot') }, async (req, reply) => {
    await socialService.joinCompetition(z.object({ id: z.string().uuid() }).parse(req.params).id, req.auth!.accountId);
    return reply.code(204).send();
  });
  app.get('/v1/bot/competitions/:id', { preHandler: requireBot }, async (req) => socialService.standings(z.object({ id: z.string().uuid() }).parse(req.params).id));
  app.get('/v1/bot/games/:game/today', { preHandler: requireBot }, async (req) => socialService.todaysRound(z.object({ game: z.enum(['guess', 'predict']) }).parse(req.params).game));
  app.post('/v1/bot/games/guess', { preHandler: requireBot }, async (req) =>
    socialService.playGuess(req.bot!.discordUserId, z.object({ guess: z.number().positive().max(1e12) }).parse(req.body ?? {}).guess),
  );
  app.post('/v1/bot/games/predict', { preHandler: requireBot }, async (req) =>
    socialService.playPredict(req.bot!.discordUserId, z.object({ direction: z.union([z.literal(1), z.literal(-1)]) }).parse(req.body ?? {}).direction),
  );
  app.get('/v1/bot/games/:game/leaderboard', { preHandler: requireBot }, async (req) => socialService.gameBoard(z.object({ game: z.enum(['guess', 'predict']) }).parse(req.params).game));
  app.get('/v1/bot/games/rich-or-not', { preHandler: requireBot }, async () => socialService.richOrNot());
};
