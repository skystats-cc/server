import { fetchStatus } from '../../ingest/hypixel.js';
import { alertsService } from '../alerts/alerts.service.js';
import { statusRepo } from './status.repo.js';

/** SkyBlock itself affected, or a major network incident */
export function skyblockDown(indicator: string, components: { name: string; status: string }[]) {
  const sb = components.find((c) => /skyblock/i.test(c.name));
  return (sb ? sb.status !== 'operational' : false) || indicator === 'major' || indicator === 'critical';
}

export const statusService = {
  async poll() {
    const s = await fetchStatus();
    const before = await statusRepo.get();
    await statusRepo.save({
      indicator: s.status.indicator,
      description: s.status.description,
      components: s.components.map((c) => ({ name: c.name, status: c.status })),
      incidents: s.incidents.map((i) => ({
        name: i.name,
        status: i.status,
        impact: i.impact ?? null,
        url: i.shortlink ?? null,
      })),
      checkedAt: new Date(),
    });
    // Free outage notices for people who opted in
    const wasDown = before ? skyblockDown(before.indicator, before.components as { name: string; status: string }[]) : null;
    const isDown = skyblockDown(s.status.indicator, s.components);
    if (wasDown !== null && wasDown !== isDown) {
      await alertsService.outageChanged(isDown, s.incidents[0]?.name ?? s.status.description);
    }
  },

  // indicator: none | minor | major | critical | unknown
  async get() {
    const row = await statusRepo.get();
    if (!row) {
      return { indicator: 'unknown', description: 'Status not checked yet', components: [], incidents: [], checkedAt: null };
    }
    const { id: _id, ...rest } = row;
    return rest;
  },
};
