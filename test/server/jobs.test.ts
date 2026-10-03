import { describe, it, expect, beforeEach } from 'bun:test';
import { startJobs, onCleanup, NotImplementedError } from '../support/index';

// Server composition, not part of the learning path (hence *.test.ts, which `bun run learn check` does not scan).
// Shape: GIVEN builds the state (beforeEach), WHEN performs the one action (beforeEach), THEN only asserts.

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A logger that records what it was given. */
function recordingLogger() {
  const warnings: string[] = [];
  const errors: string[] = [];
  return { warnings, errors, logger: { warn: (m: string) => warnings.push(m), error: (m: string) => errors.push(m) } };
}

describe('jobs run repeatedly and never overlap', () => {
  describe('GIVEN a job every 5 ms whose run takes 20 ms', () => {
    let starts: number;
    let concurrent: number;
    let maxConcurrent: number;
    let jobs: ReturnType<typeof startJobs>;
    beforeEach(() => {
      starts = 0; concurrent = 0; maxConcurrent = 0;
      jobs = startJobs([{
        name: 'slow', everyMs: 5,
        run: async () => { starts++; concurrent++; maxConcurrent = Math.max(maxConcurrent, concurrent); await sleep(20); concurrent--; },
      }], recordingLogger().logger);
      onCleanup(() => jobs.stop());
    });

    describe('WHEN 120 ms pass and the jobs are stopped', () => {
      let startsAtStop: number;
      beforeEach(async () => {
        await sleep(120);
        await jobs.stop();
        startsAtStop = starts;
        await sleep(40);
      });

      it('THEN it ran several times, one run at a time', () => {
        expect(startsAtStop).toBeGreaterThan(2);
        expect(maxConcurrent).toBe(1);
      });

      it('THEN nothing runs after stop()', () => {
        expect(starts).toBe(startsAtStop);
      });
    });
  });
});

describe('a job that hits a stub is reported once; other errors every time', () => {
  describe('GIVEN one job hitting a NotImplementedError and one throwing a real error, every 5 ms', () => {
    let log: ReturnType<typeof recordingLogger>;
    let jobs: ReturnType<typeof startJobs>;
    beforeEach(() => {
      log = recordingLogger();
      jobs = startJobs([
        { name: 'stubbed', everyMs: 5, run: () => { throw new NotImplementedError('WebhookDispatcher'); } },
        { name: 'broken', everyMs: 5, run: () => { throw new Error('disk full'); } },
      ], log.logger);
      onCleanup(() => jobs.stop());
    });

    describe('WHEN 60 ms pass', () => {
      beforeEach(async () => {
        await sleep(60);
        await jobs.stop();
      });

      it('THEN the stub is reported exactly once, by name', () => {
        expect(log.warnings).toEqual(['stubbed: not implemented yet (WebhookDispatcher); it keeps retrying quietly.']);
      });

      it('THEN the real error is reported on every failure', () => {
        expect(log.errors.length).toBeGreaterThan(2);
        expect(log.errors.every((m) => m === 'broken failed')).toBe(true);
      });
    });
  });
});
