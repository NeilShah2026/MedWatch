import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, cpSync, mkdirSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  appEnvSchema,
  functionsEnvSchema,
  parseDotenv,
  projectRefFromUrl,
} from '../../scripts/lib/env.mjs';

const ROOT = resolve(__dirname, '../..');
const REF = 'abcdefghijklmnopqrst';

describe('env helpers', () => {
  it('parses dotenv text', () => {
    expect(parseDotenv('A=1\n# c\nB="two"\nC=\'3\'\n')).toEqual({ A: '1', B: 'two', C: '3' });
  });
  it('extracts the project ref from a Supabase URL', () => {
    expect(projectRefFromUrl(`https://${REF}.supabase.co`)).toBe(REF);
    expect(projectRefFromUrl('https://example.com')).toBeNull();
    expect(projectRefFromUrl('not a url')).toBeNull();
  });
  it('requires gateway settings only when the gateway provider is enabled', () => {
    const base = {
      AI_ENABLED: 'true',
      AI_PROVIDER: 'gateway',
      AI_GATEWAY_AUTH_HEADER: 'x-api-key',
      AI_MODEL: 'm',
      SMS_PROVIDER: 'console',
      CRON_SECRET: 'x'.repeat(32),
      APP_ENV: 'development',
    };
    const r = functionsEnvSchema.safeParse(base);
    expect(r.success).toBe(false);
    expect(JSON.stringify(r.error?.issues)).toContain('AI_GATEWAY_URL');
    expect(functionsEnvSchema.safeParse({ ...base, AI_PROVIDER: 'mock' }).success).toBe(true);
  });
  it('rejects a malformed project ref', () => {
    const r = appEnvSchema.safeParse({ SUPABASE_DEV_PROJECT_REF: 'bad' });
    expect(r.success).toBe(false);
  });
});

describe('write-env.mjs', () => {
  function run(env: Record<string, string>, args: string[] = []) {
    const dir = mkdtempSync(join(tmpdir(), 'mw-env-'));
    mkdirSync(join(dir, 'scripts'));
    cpSync(join(ROOT, 'scripts'), join(dir, 'scripts'), { recursive: true });
    symlinkSync(join(ROOT, 'node_modules'), join(dir, 'node_modules'));
    const r = spawnSync('node', [join(dir, 'scripts/write-env.mjs'), ...args], {
      env: { PATH: process.env.PATH ?? '', ...env },
      encoding: 'utf8',
    });
    return { ...r, dir };
  }

  it('fails with a list of missing variables', () => {
    const r = run({});
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('VITE_SUPABASE_URL');
    expect(r.stderr).toContain('SUPABASE_SERVICE_ROLE_KEY');
  });

  it('writes both files when everything is present, deriving the project ref', () => {
    const r = run({
      SUPABASE_URL: `https://${REF}.supabase.co`,
      SUPABASE_ANON_KEY: 'anon-key-anon-key-anon-key',
      SUPABASE_SERVICE_ROLE_KEY: 'service-key-service-key-service',
      SUPABASE_ACCESS_TOKEN: 'sbp_token_123',
      SUPABASE_DB_PASSWORD: 'pw',
    });
    expect(r.status, r.stderr).toBe(0);
    const env = readFileSync(join(r.dir, '.env'), 'utf8');
    expect(env).toContain(`SUPABASE_DEV_PROJECT_REF=${REF}`);
    expect(env).toContain('VITE_APP_ENV=development');
    const fns = readFileSync(join(r.dir, '.env.functions'), 'utf8');
    expect(fns).toContain('AI_PROVIDER=mock');
    expect(fns).toMatch(/CRON_SECRET=[0-9a-f]{48}/);
    // Secrets for scripts must never be written with a VITE_ prefix.
    expect(env).not.toMatch(/VITE_[A-Z_]*SERVICE/);
  });
});
