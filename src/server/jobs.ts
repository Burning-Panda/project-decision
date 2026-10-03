import { NotImplementedError } from '../common/errors';

export interface Job {
  name: string;
  everyMs: number;
  run: () => unknown | Promise<unknown>;
}

export interface JobLogger {
  warn: (message: string) => void;
  error: (message: string, error?: unknown) => void;
}

export interface RunningJobs {
  /** Stops scheduling and waits for runs in progress. */
  stop(): Promise<void>;
}

/**
 * Runs each job every `everyMs`, waiting for one run to finish before scheduling the next (runs never overlap).
 * A job that hits a stub (NotImplementedError) is reported once, not on every tick; other errors are reported each time.
 */
export function startJobs(jobs: Job[], logger: JobLogger): RunningJobs {
  let stopped = false;
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const running = new Set<Promise<void>>();
  const reportedStubs = new Set<string>();

  const schedule = (job: Job) => {
    if (stopped) return;
    const timer = setTimeout(() => {
      timers.delete(timer);
      const run = (async () => {
        try {
          await job.run();
        } catch (e) {
          if (e instanceof NotImplementedError) {
            if (!reportedStubs.has(job.name)) logger.warn(`${job.name}: not implemented yet (${e.message}); it keeps retrying quietly.`);
            reportedStubs.add(job.name);
          } else {
            logger.error(`${job.name} failed`, e);
          }
        }
      })();
      running.add(run);
      void run.finally(() => {
        running.delete(run);
        schedule(job);
      });
    }, job.everyMs);
    timers.add(timer);
  };

  for (const job of jobs) schedule(job);

  return {
    async stop() {
      stopped = true;
      for (const t of timers) clearTimeout(t);
      timers.clear();
      await Promise.all(running);
    },
  };
}
