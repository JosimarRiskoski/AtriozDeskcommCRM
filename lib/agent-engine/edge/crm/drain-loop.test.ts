// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getEventListeners } from 'node:events';
import type pg from 'pg';
import type { Logger } from '../../obs/logger';
import { runDrainLoop, type DrainKnobs } from './drain';

const knobs: DrainKnobs = {
  batchSize: 20, intervalMs: 2_000, idleIntervalMs: 15_000,
  debounceMs: 0, reapTimeoutMs: 120_000,
};
const log = { error: vi.fn(), warn: vi.fn(), info: vi.fn() } as unknown as Logger;
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });

describe('drain idle lifecycle', () => {
  it('keeps claiming every idle tick but reaps only once per minute', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const running = runDrainLoop({ query } as unknown as pg.Pool, knobs, log, controller.signal);
    await vi.advanceTimersByTimeAsync(59_999);
    const reapCount = () => query.mock.calls.filter(([sql]) => sql.includes("set status = 'pending'")).length;
    expect(reapCount()).toBe(1);
    expect(query.mock.calls.filter(([sql]) => sql.includes('skip locked'))).toHaveLength(4);
    await vi.advanceTimersByTimeAsync(1);
    expect(reapCount()).toBe(2);
    controller.abort();
    await running;
    expect(vi.getTimerCount()).toBe(0);
  });

  it('retains at most one abort listener across idle waits', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const running = runDrainLoop({ query } as unknown as pg.Pool, knobs, log, controller.signal);
    await vi.advanceTimersByTimeAsync(150_000);
    expect(getEventListeners(controller.signal, 'abort')).toHaveLength(1);
    controller.abort();
    await running;
    expect(getEventListeners(controller.signal, 'abort')).toHaveLength(0);
  });

  it('does not wait when aborted during a database query', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const query = vi.fn().mockImplementation(async () => {
      controller.abort();
      return { rows: [] };
    });
    const running = runDrainLoop({ query } as unknown as pg.Pool, knobs, log, controller.signal);
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(0);
    await running;
  });

  it('retries a failed reaper at the next tick', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const query = vi.fn().mockRejectedValueOnce(new Error('temporary')).mockResolvedValue({ rows: [] });
    const running = runDrainLoop({ query } as unknown as pg.Pool, knobs, log, controller.signal);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(query.mock.calls.filter(([sql]) => sql.includes("set status = 'pending'"))).toHaveLength(2);
    controller.abort();
    await running;
  });
});
