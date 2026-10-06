#!/usr/bin/env node
// Push Edge Function secrets from .env.functions, then store the function base URL and
// CRON_SECRET in Supabase Vault so pg_cron / pg_net triggers can call the functions.
import { functionsEnvSchema, requireEnv, readDotenv } from './lib/env.mjs';
import { requireCliEnv, supabase } from './lib/supabase-cli.mjs';
import { runSql } from './lib/management-api.mjs';
import { log } from './lib/log.mjs';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const cli = requireCliEnv();
const fileVars = readDotenv('.env.functions');
const fns = requireEnv(functionsEnvSchema, '.env.functions', { ...fileVars });

const dir = mkdtempSync(join(tmpdir(), 'mw-secrets-'));
const file = join(dir, 'secrets.env');
writeFileSync(
  file,
  Object.entries(fns)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${k}=${v}`)
    .join('\n') + '\n',
  { mode: 0o600 },
);
try {
  supabase(['secrets', 'set', '--env-file', file, '--project-ref', cli.SUPABASE_DEV_PROJECT_REF]);
} finally {
  rmSync(dir, { recursive: true, force: true });
}

const base = `https://${cli.SUPABASE_DEV_PROJECT_REF}.supabase.co/functions/v1`;
await runSql(
  cli,
  `select private.set_function_config(${sqlLit(base)}, ${sqlLit(fns.CRON_SECRET)});`,
);
log.info('secrets:sync: function secrets set and Vault config stored.');

function sqlLit(s) {
  return `'${String(s).replace(/'/g, "''")}'`;
}
