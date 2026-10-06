#!/usr/bin/env node
// Type-check every Edge Function entrypoint with Deno (installed as an npm devDependency).
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT } from './lib/env.mjs';
import { listFunctions } from './lib/supabase-cli.mjs';
import { log } from './lib/log.mjs';

const entries = listFunctions()
  .map((n) => `supabase/functions/${n}/index.ts`)
  .filter((p) => existsSync(resolve(ROOT, p)));
if (!entries.length) {
  log.info('check-functions: no functions yet');
  process.exit(0);
}
const r = spawnSync(
  'npx',
  ['--no-install', 'deno', 'check', '--config', 'supabase/functions/deno.json', ...entries],
  { cwd: ROOT, stdio: 'inherit', env: { ...process.env, DENO_NO_UPDATE_CHECK: '1' } },
);
process.exit(r.status ?? 1);
