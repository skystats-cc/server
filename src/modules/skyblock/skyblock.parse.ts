import type { SkyblockProfilesResponse } from '../../ingest/schemas.js';
import { normalizeUuid } from '../../lib/ids.js';

export interface ParsedMember {
  uuid: string;
  /** false if they left the profile or never accepted the co-op invite */
  active: boolean;
  firstJoin: Date | null;
  purse: number | null;
  personalBank: number | null;
  skyblockXp: number | null;
}

export interface ParsedProfile {
  id: string;
  cuteName: string | null;
  gameMode: string;
  /** whether this is the *requested player's* selected profile */
  selected: boolean;
  bankBalance: number | null;
  members: ParsedMember[];
}

/** Turn Hypixel's /v2/skyblock/profiles response into the few fields we store. Pure, easy to test. */
export function parseProfiles(res: SkyblockProfilesResponse): ParsedProfile[] {
  return (res.profiles ?? []).map((p) => ({
    id: normalizeUuid(p.profile_id),
    cuteName: p.cute_name ?? null,
    gameMode: p.game_mode ?? 'normal',
    selected: p.selected === true,
    bankBalance: p.banking?.balance ?? null,
    members: Object.entries(p.members).map(([uuid, m]) => {
      const left = m.profile?.deletion_notice !== undefined;
      const pendingInvite = m.profile?.coop_invitation !== undefined && !m.profile.coop_invitation.confirmed;
      return {
        uuid: normalizeUuid(uuid),
        active: !left && !pendingInvite,
        firstJoin: m.profile?.first_join ? new Date(m.profile.first_join) : null,
        purse: m.currencies?.coin_purse ?? null,
        personalBank: m.profile?.bank_account ?? null,
        skyblockXp: m.leveling?.experience ?? null,
      };
    }),
  }));
}

/** SkyBlock level = 100 XP per level */
export const skyblockLevel = (xp: number | null) => (xp === null ? null : Math.floor(xp / 100));
