import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

function dotenv(file: string): Record<string, string> {
  const p = resolve(__dirname, '../..', file);
  if (!existsSync(p)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]!] = m[2]!;
  }
  return out;
}

const merged = { ...dotenv('.env'), ...process.env } as Record<string, string | undefined>;

export const cloud = {
  url: merged.VITE_SUPABASE_URL,
  anonKey: merged.VITE_SUPABASE_ANON_KEY,
  serviceKey: merged.SUPABASE_SERVICE_ROLE_KEY,
  appEnv: merged.APP_ENV,
  devRef: merged.SUPABASE_DEV_PROJECT_REF,
};

/** Cloud DB tests run only against the dev project with full credentials. */
export const hasCloud = Boolean(
  cloud.url &&
    cloud.anonKey &&
    cloud.serviceKey &&
    cloud.devRef &&
    cloud.url.includes(cloud.devRef) &&
    (cloud.appEnv === 'development' || cloud.appEnv === 'local'),
);
