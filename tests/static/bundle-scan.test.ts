/**
 * Spec §11 / Hard Rule 9: no AI key or service-role key may reach the browser bundle.
 * Builds the web app into a temp dir with fake secrets present in the environment, then
 * scans every emitted file for the secret values and for server-only variable names.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ROOT = resolve(__dirname, '../..');
const FAKE = {
  AI_GATEWAY_API_KEY: 'sk-fake-gateway-key-0123456789abcdef',
  SUPABASE_SERVICE_ROLE_KEY: 'fake.service.role.jwt.0123456789',
  CRON_SECRET: 'fake-cron-secret-0123456789abcdef',
  TWILIO_AUTH_TOKEN: 'fake-twilio-token-0123456789',
  SUPABASE_DB_PASSWORD: 'fake-db-password-0123456789',
  SUPABASE_ACCESS_TOKEN: 'sbp_fake_access_token_0123456789',
};
const SERVER_ONLY_NAMES = [
  'AI_GATEWAY_API_KEY',
  'AI_GATEWAY_URL',
  'SERVICE_ROLE',
  'CRON_SECRET',
  'TWILIO_AUTH_TOKEN',
  'SUPABASE_DB_PASSWORD',
  'SUPABASE_ACCESS_TOKEN',
];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p) : [p];
  });
}

let out: string;
let bundle: string;

beforeAll(() => {
  out = mkdtempSync(join(tmpdir(), 'mw-bundle-'));
  const r = spawnSync(
    process.execPath,
    [
      join(ROOT, 'node_modules/vite/bin/vite.js'),
      'build',
      '--outDir',
      out,
      '--emptyOutDir',
      '--logLevel',
      'error',
    ],
    {
      cwd: join(ROOT, 'apps/web'),
      env: {
        ...process.env,
        ...FAKE,
        VITE_SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co',
        VITE_SUPABASE_ANON_KEY: 'public-anon-key-0123456789',
        VITE_APP_ENV: 'production',
      },
      encoding: 'utf8',
    },
  );
  expect(r.status, r.stderr).toBe(0);
  bundle = files(out)
    .map((f) => readFileSync(f, 'utf8'))
    .join('\n');
}, 180_000);

describe('built frontend bundle', () => {
  it('contains no secret values', () => {
    for (const [name, value] of Object.entries(FAKE))
      expect(bundle.includes(value), name).toBe(false);
  });
  it('contains no server-only variable names', () => {
    for (const name of SERVER_ONLY_NAMES) expect(bundle.includes(name), name).toBe(false);
  });
  it('does include the public client config (sanity check that env injection works)', () => {
    expect(bundle).toContain('public-anon-key-0123456789');
  });
  it('the web source only reads the three public VITE_ variables', () => {
    const src = files(join(ROOT, 'apps/web/src'))
      .map((f) => readFileSync(f, 'utf8'))
      .join('\n');
    const used = new Set([...src.matchAll(/\bVITE_[A-Z0-9_]+/g)].map((m) => m[0]));
    expect([...used].sort()).toEqual([
      'VITE_APP_ENV',
      'VITE_SUPABASE_ANON_KEY',
      'VITE_SUPABASE_URL',
    ]);
  });
  it('no VITE_ variable in the example env files names an AI or server secret', () => {
    for (const f of ['.env.example', '.env.functions.example']) {
      const names = [...readFileSync(join(ROOT, f), 'utf8').matchAll(/^(VITE_[A-Z0-9_]+)=/gm)].map(
        (m) => m[1]!,
      );
      for (const n of names)
        expect(n).not.toMatch(/AI|KEY_SECRET|SERVICE|CRON|TWILIO|PASSWORD|ACCESS_TOKEN/);
    }
  });
});
