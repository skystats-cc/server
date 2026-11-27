import type PgBoss from 'pg-boss';
import * as bazaar from '../modules/bazaar/bazaar.jobs.js';
import * as status from '../modules/status/status.jobs.js';

export interface JobModule {
  queues: string[];
  registerWorkers: (boss: PgBoss) => Promise<void>;
}

// Add each new module here.
const modules: JobModule[] = [bazaar, status];

export const allQueues = modules.flatMap((m) => m.queues);

export async function registerAllWorkers(boss: PgBoss) {
  for (const m of modules) await m.registerWorkers(boss);
}
