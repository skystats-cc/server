import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { skyblockProfilesResponseSchema } from '../../ingest/schemas.js';
import { parseProfiles, skyblockLevel } from './skyblock.parse.js';

const fixture = skyblockProfilesResponseSchema.parse(
  JSON.parse(readFileSync(new URL('../../../test/fixtures/hypixel-profiles.json', import.meta.url), 'utf8')),
);

describe('parseProfiles', () => {
  const profiles = parseProfiles(fixture);

  it('normalizes ids and reads profile fields', () => {
    expect(profiles).toHaveLength(2);
    const [coop, solo] = profiles;
    expect(coop!.id).toBe('1a2b3c4d000040008000000000000001');
    expect(coop!.cuteName).toBe('Strawberry');
    expect(coop!.selected).toBe(true);
    expect(coop!.gameMode).toBe('normal');
    expect(coop!.bankBalance).toBe(125000000.5);
    expect(solo!.gameMode).toBe('ironman');
    expect(solo!.bankBalance).toBeNull();
  });

  it('marks members who left or never accepted as inactive', () => {
    const active = Object.fromEntries(profiles[0]!.members.map((m) => [m.uuid.slice(0, 1), m.active]));
    expect(active).toEqual({ '1': true, '2': true, '3': false, '4': false });
  });

  it('reads money fields', () => {
    const me = profiles[0]!.members.find((m) => m.uuid.startsWith('1'))!;
    expect(me.purse).toBe(4200000.25);
    expect(me.personalBank).toBe(2500000);
    expect(me.firstJoin?.toISOString()).toBe('2022-01-01T00:00:00.000Z');
    expect(skyblockLevel(me.skyblockXp)).toBe(234);
  });

  it('handles players with no profiles', () => {
    expect(parseProfiles({ success: true, profiles: null })).toEqual([]);
  });
});
