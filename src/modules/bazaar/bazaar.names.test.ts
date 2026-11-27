import { describe, expect, it } from 'vitest';
import { displayName } from './bazaar.names.js';

describe('displayName', () => {
  it('title-cases product ids', () => {
    expect(displayName('ENCHANTED_DIAMOND')).toBe('Enchanted Diamond');
    expect(displayName('BOOSTER_COOKIE')).toBe('Booster Cookie');
  });
});
