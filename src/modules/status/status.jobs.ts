import type PgBoss from 'pg-boss';
import { every } from '../../jobs/loop.js';
import { config } from '../../lib/config.js';
import { statusService } from './status.service.js';

export const queues: string[] = [];

export async function registerWorkers(_boss: PgBoss) {
  every('status.poll', config.STATUS_POLL_SECONDS * 1000, () => statusService.poll());
}
