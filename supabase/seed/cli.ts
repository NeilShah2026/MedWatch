#!/usr/bin/env -S npx tsx
/**
 * npm run seed -- --yes            insert demo data into the dev project (fails if present)
 * npm run db:reset -- --yes        wipe demo org + demo users in the dev project, then seed
 * add --target=local-pg            use LOCAL_PG_URL instead (local verification only)
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { checkGuards } from './guards.ts';
import { runSeed } from './run.ts';
import { SupabaseSeedWriter } from './writers/supabase.ts';
import { PgSeedWriter } from './writers/pg.ts';
import { seedLog } from './log.ts';

function dotenv(file: string): Record<string, string> {
  const p = resolve(import.meta.dirname, '../..', file);
  if (!existsSync(p)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]!] = m[2]!;
  }
  return out;
}

async function main() {
  const [mode, ...args] = process.argv.slice(2);
  if (mode !== 'seed' && mode !== 'reset') {
    seedLog.error('usage: cli.ts <seed|reset> [--yes] [--target=cloud|local-pg]');
    process.exit(2);
  }
  const target = args.includes('--target=local-pg') ? 'local-pg' : 'cloud';
  const env = { ...dotenv('.env'), ...process.env } as Record<string, string | undefined>;
  const guard = checkGuards({ env, args, target });
  seedLog.info(`Target: ${guard.targetDescription}`);
  seedLog.info(`APP_ENV: ${env.APP_ENV ?? '(not set)'}`);
  if (!guard.ok) {
    seedLog.error(`Refusing to ${mode}:\n${guard.errors.map((e) => `  - ${e}`).join('\n')}`);
    process.exit(1);
  }
  const writer =
    target === 'cloud'
      ? new SupabaseSeedWriter(env.VITE_SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!)
      : new PgSeedWriter(env.LOCAL_PG_URL!);
  try {
    await runSeed(writer, { mode, log: seedLog.info });
    seedLog.info(`\nDone. Demo logins use password Demo!2345 (see README).`);
  } finally {
    await writer.close();
  }
}

main().catch((e: unknown) => {
  seedLog.error(`Seed failed: ${(e as Error).message}`);
  process.exit(1);
});
