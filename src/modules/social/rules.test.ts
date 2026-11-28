import { describe, expect, it } from 'vitest';
import { consistency, earnedAchievements, guessPoints, longestStreak, pickForDay, predictionPoints } from './rules.js';

describe('social rules', () => {
  it('finds the longest positive streak over consecutive days', () => {
    const d = (day: string, change: number | null) => ({ day, change });
    expect(longestStreak([d('2026-01-01', 5), d('2026-01-02', 1), d('2026-01-03', -1), d('2026-01-04', 2)])).toBe(2);
    expect(longestStreak([d('2026-01-01', 5), d('2026-01-03', 1)])).toBe(1); // gap breaks it
  });
  it('awards achievements', () => {
    expect(earnedAchievements({ maxTotal: 2e9, sessions: 12, longestStreak: 8, createdAt: new Date('2026-12-01'), paid: false })).toEqual([
      'first_million', 'first_billion', 'sessions_10', 'streak_7', 'early_adopter',
    ]);
  });
  it('scores games without stakes', () => {
    expect(guessPoints(100, 100)).toBe(100);
    expect(guessPoints(150, 100)).toBe(0);
    expect(guessPoints(110, 100)).toBeGreaterThan(70);
    expect(predictionPoints(1, 10, 11)).toBe(10);
    expect(predictionPoints(-1, 10, 11)).toBe(0);
    expect(predictionPoints(1, 10, 10)).toBe(0);
  });
  it('picks the same item for everyone on a day', () => {
    expect(pickForDay(['A', 'B', 'C'], '2026-12-01', 'guess')).toBe(pickForDay(['A', 'B', 'C'], '2026-12-01', 'guess'));
    expect(pickForDay([], 'x', 'y')).toBeNull();
  });
  it('measures consistency', () => expect(consistency([{ change: 1 }, { change: -1 }, { change: null }])).toBe(0.5));
});
