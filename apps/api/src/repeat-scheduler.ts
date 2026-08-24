export interface RepeatScheduler {
  stop(): void;
}

interface RepeatSchedulerOptions {
  intervalMs?: number;
  onError?: (error: unknown) => void;
}

export function startRepeatScheduler(
  generate: () => void,
  options: RepeatSchedulerOptions = {},
): RepeatScheduler {
  const run = (): void => {
    try {
      generate();
    } catch (error) {
      options.onError?.(error);
    }
  };
  run();
  const timer = setInterval(run, options.intervalMs ?? 60 * 60 * 1_000);
  timer.unref();
  return { stop: () => clearInterval(timer) };
}
