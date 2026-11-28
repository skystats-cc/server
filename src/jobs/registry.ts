import { captureError } from '../lib/sentry.js';
import { jobRuns as jobRunsMetric } from '../lib/metrics.js';
import { platformRepo } from '../modules/platform/platform.repo.js';
import { cronIntervalMinutes } from '../modules/platform/helpers.js';
import type PgBoss from 'pg-boss';
import * as accounts from '../modules/accounts/accounts.jobs.js';
import * as alerts from '../modules/alerts/alerts.jobs.js';
import * as bazaar from '../modules/bazaar/bazaar.jobs.js';
import * as insight from '../modules/insight/insight.jobs.js';
import * as market from '../modules/market/market.jobs.js';
import * as platform from '../modules/platform/platform.jobs.js';
import * as money from '../modules/money/money.jobs.js';
import * as social from '../modules/social/social.jobs.js';
import * as skyblock from '../modules/skyblock/skyblock.jobs.js';
import * as status from '../modules/status/status.jobs.js';
import type { QueueDef } from './queue.js';

export interface JobModule {
  queues: QueueDef[];
  registerWorkers: (boss: PgBoss) => Promise<void>;
}

// Add each new module here.
const modules: JobModule[] = [bazaar, status, accounts, skyblock, money, alerts, market, insight, social, platform];

export const allQueues = modules.flatMap((m) => m.queues);
export const allQueueNames = allQueues.map((q) => (typeof q === 'string' ? q : q.name));

export async function registerAllWorkers(boss: PgBoss) {
  const tracked = trackJobs(boss);
  for (const m of modules) await m.registerWorkers(tracked);
}

/** Wraps boss.work/schedule so every queue records its last success/failure (job health) and metrics */
function trackJobs(boss: PgBoss): PgBoss {
  return new Proxy(boss, {
    get(target, prop, receiver) {
      if (prop === 'work') {
        return (name: string, ...rest: unknown[]) => {
          const handler = rest.pop() as (jobs: unknown) => Promise<unknown>;
          const wrapped = async (jobs: unknown) => {
            try {
              const r = await handler(jobs);
              jobRunsMetric.inc({ queue: name, outcome: 'ok' });
              void platformRepo.jobOk(name, null).catch(() => {});
              return r;
            } catch (err) {
              jobRunsMetric.inc({ queue: name, outcome: 'error' });
              captureError(err, { queue: name });
              void platformRepo.jobFailed(name, String((err as Error)?.message ?? err)).catch(() => {});
              throw err;
            }
          };
          return (target.work as (...a: unknown[]) => Promise<string>).call(target, name, ...rest, wrapped);
        };
      }
      if (prop === 'schedule') {
        return (name: string, cron: string, ...rest: unknown[]) => {
          const every = cronIntervalMinutes(cron);
          if (every) void platformRepo.setExpected(name, every).catch(() => {});
          return (target.schedule as (...a: unknown[]) => Promise<void>).call(target, name, cron, ...rest);
        };
      }
      const v = Reflect.get(target, prop, receiver);
      return typeof v === 'function' ? v.bind(target) : v;
    },
  });
}
