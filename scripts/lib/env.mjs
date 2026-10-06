import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { log } from './log.mjs';

// fileURLToPath (not URL.pathname) so paths with spaces and Windows drive letters work.
export const ROOT = fileURLToPath(new URL('../..', import.meta.url));

const appEnv = z.enum(['local', 'development', 'staging', 'production']);

/** Variables for the frontend (.env, VITE_*) and Node scripts. */
export const appEnvSchema = z.object({
  VITE_SUPABASE_URL: z.string().url(),
  VITE_SUPABASE_ANON_KEY: z.string().min(20),
  VITE_APP_ENV: appEnv,
  SUPABASE_DEV_PROJECT_REF: z
    .string()
    .regex(/^[a-z0-9]{20}$/, 'must be a 20-character project ref'),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
  APP_ENV: appEnv,
  SUPABASE_ACCESS_TOKEN: z.string().min(10),
  SUPABASE_DB_PASSWORD: z.string().min(1),
});

/** Variables synced to Supabase Edge Function secrets (.env.functions). */
export const functionsEnvSchema = z
  .object({
    AI_ENABLED: z.enum(['true', 'false']),
    AI_PROVIDER: z.enum(['gateway', 'mock']),
    AI_GATEWAY_URL: z.string().url().optional(),
    AI_GATEWAY_API_KEY: z.string().min(1).optional(),
    AI_GATEWAY_AUTH_HEADER: z.string().min(1),
    AI_MODEL: z.string().min(1),
    SMS_PROVIDER: z.enum(['console', 'twilio']),
    TWILIO_ACCOUNT_SID: z.string().optional(),
    TWILIO_AUTH_TOKEN: z.string().optional(),
    TWILIO_FROM_NUMBER: z.string().optional(),
    CRON_SECRET: z.string().min(16),
    APP_ENV: appEnv,
    APP_URL: z.string().url().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.AI_ENABLED === 'true' && v.AI_PROVIDER === 'gateway') {
      for (const k of ['AI_GATEWAY_URL', 'AI_GATEWAY_API_KEY']) {
        if (!v[k])
          ctx.addIssue({ code: 'custom', path: [k], message: 'required when AI_PROVIDER=gateway' });
      }
    }
    if (v.SMS_PROVIDER === 'twilio') {
      for (const k of ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_FROM_NUMBER']) {
        if (!v[k])
          ctx.addIssue({ code: 'custom', path: [k], message: 'required when SMS_PROVIDER=twilio' });
      }
    }
  });

export function parseDotenv(text) {
  const out = {};
  // Tolerate a UTF-8 BOM (Notepad), CRLF line endings, `export KEY=...` and inline comments.
  for (const line of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))
      v = v.slice(1, -1);
    else v = v.replace(/\s+#.*$/, '');
    out[m[1]] = v;
  }
  return out;
}

export function readDotenv(file) {
  const p = resolve(ROOT, file);
  return existsSync(p) ? parseDotenv(readFileSync(p, 'utf8')) : {};
}

/** Merge .env, .env.functions and process.env (process.env wins). */
export function loadEnv() {
  // Empty process.env values must not hide values from the files.
  const fromProcess = Object.fromEntries(
    Object.entries(process.env).filter(([, v]) => v !== undefined && v !== ''),
  );
  const env = { ...readDotenv('.env'), ...readDotenv('.env.functions'), ...fromProcess };
  if (!env.SUPABASE_DEV_PROJECT_REF) {
    const ref = projectRefFromUrl(env.VITE_SUPABASE_URL ?? env.SUPABASE_URL ?? '');
    if (ref) env.SUPABASE_DEV_PROJECT_REF = ref;
  }
  return env;
}

export function formatIssues(error) {
  return error.issues.map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`).join('\n');
}

/** Validate and return env, or exit with a clear list of problems. */
export function requireEnv(schema, label, source = loadEnv()) {
  const r = schema.safeParse(source);
  if (!r.success) {
    log.error(`Missing or invalid ${label} environment variables:\n${formatIssues(r.error)}`);
    process.exit(1);
  }
  return r.data;
}

export function projectRefFromUrl(url) {
  try {
    const host = new URL(url).hostname;
    const m = host.match(/^([a-z0-9]{20})\.supabase\.(co|in|net)$/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}
