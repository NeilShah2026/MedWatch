#!/usr/bin/env node
// Generates the gitignored .env and .env.functions from process.env.
// Run at the start of every cloud session: `npm run env:write`.
import { writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import {
  ROOT,
  appEnvSchema,
  functionsEnvSchema,
  formatIssues,
  projectRefFromUrl,
  readDotenv,
} from './lib/env.mjs';
import { log } from './lib/log.mjs';

const e = process.env;
const pick = (...names) => names.map((n) => e[n]).find((v) => v !== undefined && v !== '');

const url = pick('VITE_SUPABASE_URL', 'SUPABASE_URL');
const app = {
  VITE_SUPABASE_URL: url,
  VITE_SUPABASE_ANON_KEY: pick('VITE_SUPABASE_ANON_KEY', 'SUPABASE_ANON_KEY'),
  VITE_APP_ENV: pick('VITE_APP_ENV', 'APP_ENV') ?? 'development',
  SUPABASE_DEV_PROJECT_REF:
    pick('SUPABASE_DEV_PROJECT_REF') ?? (url ? projectRefFromUrl(url) : undefined),
  SUPABASE_SERVICE_ROLE_KEY: pick('SUPABASE_SERVICE_ROLE_KEY'),
  APP_ENV: pick('APP_ENV') ?? 'development',
  SUPABASE_ACCESS_TOKEN: pick('SUPABASE_ACCESS_TOKEN'),
  SUPABASE_DB_PASSWORD: pick('SUPABASE_DB_PASSWORD'),
};

// Keep an existing CRON_SECRET stable across sessions; generate one only if none exists.
const prevFns = readDotenv('.env.functions');
const fns = {
  AI_ENABLED: pick('AI_ENABLED') ?? 'false',
  AI_PROVIDER: pick('AI_PROVIDER') ?? 'mock',
  AI_GATEWAY_URL: pick('AI_GATEWAY_URL'),
  AI_GATEWAY_API_KEY: pick('AI_GATEWAY_API_KEY'),
  AI_GATEWAY_AUTH_HEADER: pick('AI_GATEWAY_AUTH_HEADER') ?? 'x-api-key',
  AI_MODEL: pick('AI_MODEL') ?? 'claude-sonnet-5-5',
  SMS_PROVIDER: pick('SMS_PROVIDER') ?? 'console',
  TWILIO_ACCOUNT_SID: pick('TWILIO_ACCOUNT_SID'),
  TWILIO_AUTH_TOKEN: pick('TWILIO_AUTH_TOKEN'),
  TWILIO_FROM_NUMBER: pick('TWILIO_FROM_NUMBER'),
  CRON_SECRET: pick('CRON_SECRET') ?? prevFns.CRON_SECRET ?? randomBytes(24).toString('hex'),
  APP_ENV: app.APP_ENV,
  APP_URL: pick('APP_URL'),
};

const problems = [];
const a = appEnvSchema.safeParse(app);
if (!a.success) problems.push(`.env:\n${formatIssues(a.error)}`);
const f = functionsEnvSchema.safeParse(fns);
if (!f.success) problems.push(`.env.functions:\n${formatIssues(f.error)}`);

const serialize = (obj) =>
  Object.entries(obj)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}=${v}`)
    .join('\n') + '\n';

const partial = process.argv.includes('--partial');
if (problems.length && !partial) {
  log.error(
    `write-env: cannot write env files. Fix these variables in the cloud environment settings:\n\n${problems.join('\n\n')}\n\n(Use --partial to write whatever is available.)`,
  );
  process.exit(1);
}

writeFileSync(resolve(ROOT, '.env'), serialize(app));
writeFileSync(resolve(ROOT, '.env.functions'), serialize(fns));
log.info(
  `write-env: wrote .env and .env.functions${problems.length ? ' (PARTIAL — some values missing)' : ''}.`,
);
if (problems.length) log.warn(problems.join('\n\n'));
if (!existsSync(resolve(ROOT, 'node_modules')))
  log.warn('write-env: run `npm ci || npm install` next.');
