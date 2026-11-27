import type PgBoss from 'pg-boss';
import * as accounts from '../modules/accounts/accounts.jobs.js';
import * as alerts from '../modules/alerts/alerts.jobs.js';
import * as bazaar from '../modules/bazaar/bazaar.jobs.js';
import * as money from '../modules/money/money.jobs.js';
import * as skyblock from '../modules/skyblock/skyblock.jobs.js';
import * as status from '../modules/status/status.jobs.js';
import type { QueueDef } from './queue.js';

export interface JobModule {
  queues: QueueDef[];
  registerWorkers: (boss: PgBoss) => Promise<void>;
}

// Add each new module here.
const modules: JobModule[] = [bazaar, status, accounts, skyblock, money, alerts];

export const allQueues = modules.flatMap((m) => m.queues);
export const allQueueNames = allQueues.map((q) => (typeof q === 'string' ? q : q.name));

export async function registerAllWorkers(boss: PgBoss) {
  for (const m of modules) await m.registerWorkers(boss);
}
