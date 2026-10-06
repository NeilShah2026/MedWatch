#!/usr/bin/env node
// Type-check every Edge Function entrypoint with Deno (installed as an npm devDependency).
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT } from './lib/env.mjs';
import { listFunctions } from './lib/supabase-cli.mjs';
import { log } from './lib/log.mjs';
import { runBin } from './lib/bin.mjs';

const entries = listFunctions()
  .map((n) => `supabase/functions/${n}/index.ts`)
  .filter((p) => existsSync(resolve(ROOT, p)));
if (!entries.length) {
  log.info('check-functions: no functions yet');
  process.exit(0);
}
const r = runBin('deno', ['check', '--config', 'supabase/functions/deno.json', ...entries], {
  env: { ...process.env, DENO_NO_UPDATE_CHECK: '1' },
});
if (r.error) log.error(`Could not start Deno: ${r.error.message}`);
process.exit(r.status);
