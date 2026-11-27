import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { bazaarService } from './bazaar.service.js';

const productParams = z.object({
  productId: z
    .string()
    .regex(/^[A-Za-z0-9_:\-]{1,64}$/)
    .transform((s) => s.toUpperCase()),
});
const listQuery = z.object({ q: z.string().max(64).optional() });
const historyQuery = z.object({ days: z.coerce.number().int().min(1).max(3650).default(7) });

export const bazaarRoutes: FastifyPluginAsync = async (app) => {
  app.get('/v1/bazaar', async (req) => {
    const { q } = listQuery.parse(req.query);
    return { products: await bazaarService.list(q) };
  });

  app.get('/v1/bazaar/:productId', async (req) => {
    const { productId } = productParams.parse(req.params);
    return bazaarService.get(productId);
  });

  app.get('/v1/bazaar/:productId/history', async (req) => {
    const { productId } = productParams.parse(req.params);
    const { days } = historyQuery.parse(req.query);
    return { productId, days, snapshots: await bazaarService.history(productId, days) };
  });
};
