import { describe, it, expect, beforeEach } from 'bun:test';
import { readConfig, ConfigError } from '../support/index';

// Server composition, not part of the learning path (hence *.test.ts, which `bun run learn check` does not scan).
// Shape: GIVEN builds the state (beforeEach), WHEN performs the one action (beforeEach), THEN only asserts.

const KEY = 'a'.repeat(44);

describe('readConfig: defaults', () => {
  describe('GIVEN an empty environment', () => {
    describe('WHEN it is read', () => {
      let config: ReturnType<typeof readConfig>;
      beforeEach(() => { config = readConfig({}); });

      it('THEN the server runs in memory on port 3000 with private webhook targets refused and email off', () => {
        expect(config).toEqual({ port: 3000, storage: { kind: 'memory' }, secretsKey: false, rotateSecrets: false, allowPrivateTargets: false });
      });
    });
  });
});

describe('readConfig: storage', () => {
  const cases: Array<[string, Record<string, string>, unknown]> = [
    ['DATABASE_FILE', { DATABASE_FILE: './data/log.db' }, { kind: 'sqlite', file: './data/log.db' }],
    ['DATA_FILE', { DATA_FILE: './data/log.json' }, { kind: 'json', file: './data/log.json' }],
    ['DATABASE_URL and DATABASE_SCHEMA', { DATABASE_URL: 'postgres://x/db', DATABASE_SCHEMA: 'decision_log' }, { kind: 'postgres', url: 'postgres://x/db', schema: 'decision_log' }],
    ['blank storage variables', { DATABASE_FILE: '', DATABASE_URL: '  ' }, { kind: 'memory' }],
  ];
  for (const [label, env, storage] of cases) {
    describe(`GIVEN ${label} and a secrets key`, () => {
      describe('WHEN it is read', () => {
        let config: ReturnType<typeof readConfig>;
        beforeEach(() => { config = readConfig({ ...env, SECRETS_KEY: KEY }); });

        it(`THEN storage is ${(storage as any).kind}`, () => {
          expect(config.storage).toEqual(storage as any);
        });
      });
    });
  }
});

describe('readConfig: refused combinations', () => {
  const refused: Array<[string, Record<string, string>, RegExp]> = [
    ['two storage options', { DATABASE_FILE: 'a.db', DATA_FILE: 'a.json', SECRETS_KEY: KEY }, /at most one storage option.*DATABASE_FILE, DATA_FILE/],
    ['persisted storage without SECRETS_KEY', { DATABASE_FILE: 'a.db' }, /SECRETS_KEY is required/],
    ['SMTP_URL without EMAIL_FROM', { SMTP_URL: 'smtp://localhost:25' }, /EMAIL_FROM is required/],
    ['a PORT that is not a number', { PORT: 'eighty' }, /PORT must be a port number/],
  ];
  for (const [label, env, message] of refused) {
    describe(`GIVEN ${label}`, () => {
      describe('WHEN it is read', () => {
        let read: () => unknown;
        beforeEach(() => { read = () => readConfig(env); });

        it('THEN a ConfigError explains what to fix', () => {
          expect(read).toThrow(ConfigError);
          expect(read).toThrow(message);
        });
      });
    });
  }
});

describe('readConfig: optional features', () => {
  describe('GIVEN email, a public URL, a previous key and WEBHOOK_ALLOW_PRIVATE=1', () => {
    describe('WHEN it is read', () => {
      let config: ReturnType<typeof readConfig>;
      beforeEach(() => {
        config = readConfig({
          PORT: '8080', APP_URL: 'https://decisions.example.com', SMTP_URL: 'smtp://mail:587', EMAIL_FROM: 'Log <noreply@example.com>',
          EMAIL_REPLY_TO: 'help@example.com', SECRETS_KEY: KEY, SECRETS_KEY_PREVIOUS: KEY, WEBHOOK_ALLOW_PRIVATE: '1',
        });
      });

      it('THEN each is enabled', () => {
        expect(config).toMatchObject({
          port: 8080, appUrl: 'https://decisions.example.com', secretsKey: true, rotateSecrets: true, allowPrivateTargets: true,
          email: { smtpUrl: 'smtp://mail:587', from: 'Log <noreply@example.com>', replyTo: 'help@example.com' },
        });
      });
    });
  });
});
