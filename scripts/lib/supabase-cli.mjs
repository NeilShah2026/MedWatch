import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { ROOT, loadEnv, requireEnv } from './env.mjs';
import { log } from './log.mjs';

export const cliEnvSchema = z.object({
  SUPABASE_ACCESS_TOKEN: z.string().min(10),
  SUPABASE_DB_PASSWORD: z.string().min(1),
  SUPABASE_DEV_PROJECT_REF: z.string().regex(/^[a-z0-9]{20}$/),
});

/** Run the Supabase CLI non-interactively. Exits the process on failure. */
export function supabase(args, { env = loadEnv(), allowFail = false, input } = {}) {
  log.info(`$ supabase ${args.map((a) => (a.length > 40 ? a.slice(0, 8) + '…' : a)).join(' ')}`);
  const r = spawnSync('npx', ['--no-install', 'supabase', ...args], {
    cwd: ROOT,
    stdio: input ? ['pipe', 'inherit', 'inherit'] : 'inherit',
    input,
    env: { ...env, SUPABASE_INTERNAL_NO_DOTENV: '1' },
  });
  if (r.status !== 0 && !allowFail) {
    log.error(`supabase ${args[0]} failed with exit code ${r.status}`);
    process.exit(r.status ?? 1);
  }
  return r.status ?? 1;
}

export function requireCliEnv() {
  const env = loadEnv();
  if (!existsSync(resolve(ROOT, '.env'))) {
    log.error(
      `No .env file found at ${resolve(ROOT, '.env')} (copy .env.example there and fill it in).`,
    );
  }
  return requireEnv(cliEnvSchema, 'Supabase CLI', env);
}

export function link(env) {
  supabase([
    'link',
    '--project-ref',
    env.SUPABASE_DEV_PROJECT_REF,
    '--password',
    env.SUPABASE_DB_PASSWORD,
  ]);
}

export function listFunctions() {
  const dir = resolve(ROOT, 'supabase/functions');
  return readdirSync(dir).filter(
    (n) => !n.startsWith('_') && !n.startsWith('.') && statSync(resolve(dir, n)).isDirectory(),
  );
}
