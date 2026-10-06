import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

function dotenv(): Record<string, string> {
  const p = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../.env');
  if (!existsSync(p)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]!] = m[2]!;
  }
  return out;
}

const env = { ...dotenv(), ...process.env };

/**
 * Backend-dependent E2E tests run against the cloud dev project seeded with
 * `npm run db:reset -- --yes` and AI_PROVIDER=mock. Without those credentials they are
 * skipped (recorded in PROGRESS.md as "not run in sandbox").
 */
export const hasBackend = Boolean(
  env.VITE_SUPABASE_URL &&
    env.VITE_SUPABASE_ANON_KEY &&
    env.SUPABASE_SERVICE_ROLE_KEY &&
    !env.VITE_SUPABASE_URL.includes('localhost'),
);
export const backendEnv = env;
export const DEMO_PASSWORD = 'Demo!2345';
export const users = {
  admin: 'admin@demo.medwatch',
  nurse1: 'nurse1@demo.medwatch',
  nurse2: 'nurse2@demo.medwatch',
  caregiver1: 'caregiver1@demo.medwatch',
  caregiver2: 'caregiver2@demo.medwatch',
  patient1: 'patient1@demo.medwatch',
} as const;
