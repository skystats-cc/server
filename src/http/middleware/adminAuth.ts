import { timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../../lib/config.js';

const expected = Buffer.from(config.ADMIN_API_KEY);

export async function adminAuth(req: FastifyRequest, reply: FastifyReply) {
  const given = Buffer.from(String(req.headers['x-admin-key'] ?? ''));
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return reply.code(401).send({ error: 'unauthorized' });
  }
}
