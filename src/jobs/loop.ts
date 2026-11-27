import { logger } from '../lib/logger.js';

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
    } catch (err) {
      logger.error({ err, loop: name }, 'loop iteration failed');
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
