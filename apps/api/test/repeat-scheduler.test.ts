import { afterEach, describe, expect, it, vi } from 'vitest';
import { startRepeatScheduler } from '../src/repeat-scheduler.js';

describe('repeat scheduler', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs at startup and on every interval until stopped', async () => {
    vi.useFakeTimers();
    const generate = vi.fn();
    const scheduler = startRepeatScheduler(generate, { intervalMs: 1_000 });

    expect(generate).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(generate).toHaveBeenCalledTimes(3);
    scheduler.stop();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(generate).toHaveBeenCalledTimes(3);
  });

  it('reports one failure and continues on the next interval', async () => {
    vi.useFakeTimers();
    const failure = new Error('transient');
    const generate = vi.fn()
      .mockImplementationOnce(() => { throw failure; })
      .mockImplementation(() => undefined);
    const onError = vi.fn();
    const scheduler = startRepeatScheduler(generate, { intervalMs: 1_000, onError });

    expect(onError).toHaveBeenCalledWith(failure);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(generate).toHaveBeenCalledTimes(2);
    expect(onError).toHaveBeenCalledTimes(1);
    scheduler.stop();
  });
});
