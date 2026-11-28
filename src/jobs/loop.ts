import { logger } from '../lib/logger.js';
import { jobRuns } from '../lib/metrics.js';
import { platformRepo } from '../modules/platform/platform.repo.js';

// For jobs that run more often than once a minute (pg-boss cron is minute-granular).
// Runs immediately, never overlaps itself, logs and survives errors.
const timers = new Set<NodeJS.Timeout>();

export function every(name: string, ms: number, fn: () => Promise<unknown>) {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await fn();
      jobRuns.inc({ queue: name, outcome: 'ok' });
      void platformRepo.jobOk(name, Math.max(1, Math.round(ms / 60_000))).catch(() => {});
    } catch (err) {
      logger.error({ err, loop: name }, 'loop iteration failed');
      jobRuns.inc({ queue: name, outcome: 'error' });
      void platformRepo.jobFailed(name, String((err as Error)?.message ?? err)).catch(() => {});
    } finally {
      running = false;
    }
  };
  void tick();
  timers.add(setInterval(tick, ms));
  logger.info({ loop: name, everyMs: ms }, 'loop started');
}

export function stopAllLoops() {
  for (const t of timers) clearInterval(t);
  timers.clear();
}
