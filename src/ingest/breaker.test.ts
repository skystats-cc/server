import { describe, expect, it } from 'vitest';
import { CircuitBreaker, CircuitOpenError } from './breaker.js';

const fail = (upstreamStatus?: number) => async () => {
  throw Object.assign(new Error('x'), { upstreamStatus });
};

describe('CircuitBreaker', () => {
  it('opens after repeated 5xx failures and closes after the cool-down', async () => {
    let t = 0;
    const b = new CircuitBreaker('hypixel', 2, 1000, () => t);
    await expect(b.run(fail(502))).rejects.toThrow('x');
    await expect(b.run(fail(503))).rejects.toThrow('x');
    await expect(b.run(async () => 1)).rejects.toBeInstanceOf(CircuitOpenError);
    t = 1001;
    await expect(b.run(async () => 1)).resolves.toBe(1);
  });
  it('ignores 4xx errors', async () => {
    const b = new CircuitBreaker('hypixel', 1, 1000, () => 0);
    await expect(b.run(fail(404))).rejects.toThrow('x');
    await expect(b.run(async () => 2)).resolves.toBe(2);
  });
});
