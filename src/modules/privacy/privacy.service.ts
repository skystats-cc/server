import { NotFoundError } from '../../lib/errors.js';
import { audit } from '../audit/audit.repo.js';
import { billingService } from '../billing/billing.service.js';
import { privacyRepo, type PrivacySettings } from './privacy.repo.js';

export const privacyService = {
  async get(accountId: string) {
    const s = await privacyRepo.get(accountId);
    if (!s) throw new NotFoundError('account');
    return s;
  },

  async update(accountId: string, set: Partial<PrivacySettings>, via: 'web' | 'bot' | 'mod' = 'web') {
    const before = await this.get(accountId);
    await privacyRepo.update(accountId, set);
    const after = await this.get(accountId);
    const changed = Object.fromEntries(
      (Object.keys(set) as (keyof PrivacySettings)[]).filter((k) => before[k] !== after[k]).map((k) => [k, after[k]]),
    );
    if (Object.keys(changed).length) await audit.log('user', 'privacy.updated', accountId, { ...changed, via });
    return after;
  },

  async exportData(accountId: string) {
    const data = await privacyRepo.exportAll(accountId);
    if (!data) throw new NotFoundError('account');
    await audit.log('user', 'data.exported', accountId);
    return { exportedAt: new Date().toISOString(), controller: 'SkyStats.cc', ...data };
  },

  /** Cancel any paid subscription first, then erase. Irreversible. */
  async deleteAccount(accountId: string) {
    await billingService.cancelForErasure(accountId);
    const erased = await privacyRepo.erase(accountId);
    if (!erased) throw new NotFoundError('account');
    await audit.log('user', 'account.erased', accountId); // id only; no personal data kept here
  },
};
