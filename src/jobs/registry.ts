import type PgBoss from 'pg-boss';
import * as players from '../modules/players/players.jobs.js';

// Add each new module here.
const modules: { queues: string[]; registerWorkers: (boss: PgBoss) => Promise<void> }[] = [players];

export const allQueues = modules.flatMap((m) => m.queues);

export async function registerAllWorkers(boss: PgBoss) {
  for (const m of modules) await m.registerWorkers(boss);
}
