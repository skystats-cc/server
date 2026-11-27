import { fetchStatus } from '../../ingest/hypixel.js';
import { statusRepo } from './status.repo.js';

export const statusService = {
  async poll() {
    const s = await fetchStatus();
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
