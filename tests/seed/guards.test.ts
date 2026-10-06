import { describe, expect, it } from 'vitest';
import { checkGuards } from '../../supabase/seed/guards.ts';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const REF = 'abcdefghijklmnopqrst';
const okCloud = {
  APP_ENV: 'development',
  VITE_SUPABASE_URL: `https://${REF}.supabase.co`,
  SUPABASE_DEV_PROJECT_REF: REF,
  SUPABASE_SERVICE_ROLE_KEY: 'service',
};

describe('destructive script guards (Hard Rule 10)', () => {
  it('passes for the dev project with --yes', () => {
    const r = checkGuards({ env: okCloud, args: ['--yes'], target: 'cloud' });
    expect(r).toMatchObject({ ok: true, errors: [] });
    expect(r.targetDescription).toContain(REF);
  });
  it('requires --yes', () => {
    expect(checkGuards({ env: okCloud, args: [], target: 'cloud' }).errors.join()).toContain(
      '--yes',
    );
  });
  it('refuses production and unknown environments', () => {
    expect(
      checkGuards({
        env: { ...okCloud, APP_ENV: 'production' },
        args: ['--yes'],
        target: 'cloud',
      }).errors.join(),
    ).toContain('never allowed in production');
    expect(
      checkGuards({ env: { ...okCloud, APP_ENV: 'staging' }, args: ['--yes'], target: 'cloud' }).ok,
    ).toBe(false);
    expect(
      checkGuards({ env: { ...okCloud, APP_ENV: undefined }, args: ['--yes'], target: 'cloud' }).ok,
    ).toBe(false);
  });
  it('refuses any project that is not the dev project', () => {
    const r = checkGuards({
      env: { ...okCloud, VITE_SUPABASE_URL: 'https://zzzzzzzzzzzzzzzzzzzz.supabase.co' },
      args: ['--yes'],
      target: 'cloud',
    });
    expect(r.errors.join()).toContain('is not the dev project');
    expect(
      checkGuards({
        env: { ...okCloud, SUPABASE_DEV_PROJECT_REF: undefined },
        args: ['--yes'],
        target: 'cloud',
      }).ok,
    ).toBe(false);
    expect(
      checkGuards({
        env: { ...okCloud, VITE_SUPABASE_URL: 'https://example.com' },
        args: ['--yes'],
        target: 'cloud',
      }).ok,
    ).toBe(false);
  });
  it('local target must be localhost', () => {
    expect(
      checkGuards({
        env: { APP_ENV: 'local', LOCAL_PG_URL: 'postgres://u@127.0.0.1:5432/db' },
        args: ['--yes'],
        target: 'local-pg',
      }).ok,
    ).toBe(true);
    expect(
      checkGuards({
        env: { APP_ENV: 'local', LOCAL_PG_URL: 'postgres://u@db.example.com/db' },
        args: ['--yes'],
        target: 'local-pg',
      }).ok,
    ).toBe(false);
  });
  it('the CLI exits non-zero and prints the target without --yes', () => {
    const tsx = resolve(__dirname, '../../node_modules/tsx/dist/cli.mjs');
    const r = spawnSync(
      process.execPath,
      [tsx, resolve(__dirname, '../../supabase/seed/cli.ts'), 'reset'],
      {
        env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', ...okCloud },
        encoding: 'utf8',
        cwd: resolve(__dirname, '../..'),
      },
    );
    expect(r.status).toBe(1);
    expect(r.stdout).toContain(`Target: Supabase project ${REF}`);
    expect(r.stderr).toContain('--yes');
  });
});
