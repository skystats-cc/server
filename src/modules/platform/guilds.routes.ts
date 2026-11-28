import { eq, isNotNull } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { db } from '../../db/client.js';
import { guildSettings } from '../../db/schema.js';
import { requireBot } from '../../http/auth.js';

const snowflake = z.string().regex(/^\d{17,20}$/);
const params = z.object({ guildId: snowflake });
const body = z
  .object({
    statusChannelId: snowflake.nullable(),
    newsChannelId: snowflake.nullable(),
    boardChannelId: snowflake.nullable(),
    bazaarChannelId: snowflake.nullable(),
    verifiedRoleId: snowflake.nullable(),
  })
  .partial()
  .strict();
const KINDS = { status: guildSettings.statusChannelId, news: guildSettings.newsChannelId, board: guildSettings.boardChannelId, bazaar: guildSettings.bazaarChannelId } as const;

const empty = (guildId: string) => ({ guildId, statusChannelId: null, newsChannelId: null, boardChannelId: null, bazaarChannelId: null, verifiedRoleId: null });

// Bot-only. The bot checks the caller has Manage Server before calling PUT.
export const guildRoutes: FastifyPluginAsync = async (app) => {
  app.get('/v1/bot/guilds/:guildId/settings', { preHandler: requireBot }, async (req) => {
    const { guildId } = params.parse(req.params);
    const [r] = await db.select().from(guildSettings).where(eq(guildSettings.guildId, guildId)).limit(1);
    if (!r) return empty(guildId);
    const { updatedAt: _u, updatedBy: _b, ...rest } = r;
    return rest;
  });

  app.put('/v1/bot/guilds/:guildId/settings', { preHandler: requireBot }, async (req) => {
    const { guildId } = params.parse(req.params);
    const set = { ...body.parse(req.body ?? {}), updatedBy: req.bot!.discordUserId, updatedAt: new Date() };
    const [r] = await db.insert(guildSettings).values({ guildId, ...set }).onConflictDoUpdate({ target: guildSettings.guildId, set }).returning();
    const { updatedAt: _u, updatedBy: _b, ...rest } = r!;
    return rest;
  });

  // The bot was removed from a server: forget its settings
  app.delete('/v1/bot/guilds/:guildId/settings', { preHandler: requireBot }, async (req, reply) => {
    const { guildId } = params.parse(req.params);
    await db.delete(guildSettings).where(eq(guildSettings.guildId, guildId));
    return reply.code(204).send();
  });

  // Channels that asked for a kind of post (status alerts, patch notes, boards, live bazaar)
  app.get('/v1/bot/guild-channels', { preHandler: requireBot }, async (req) => {
    const { kind } = z.object({ kind: z.enum(['status', 'news', 'board', 'bazaar']) }).parse(req.query);
    const col = KINDS[kind];
    const rows = await db.select({ guildId: guildSettings.guildId, channelId: col }).from(guildSettings).where(isNotNull(col));
    return { channels: rows.map((r) => ({ guildId: r.guildId, channelId: r.channelId! })) };
  });
};
