#!/usr/bin/env node
// Deploy every Edge Function under supabase/functions (folders not starting with "_").
import { listFunctions, requireCliEnv, supabase } from './lib/supabase-cli.mjs';
import { log } from './lib/log.mjs';
const env = requireCliEnv();
const only = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const names = only.length ? only : listFunctions();
for (const name of names) {
  supabase([
    'functions',
    'deploy',
    name,
    '--project-ref',
    env.SUPABASE_DEV_PROJECT_REF,
    '--use-api',
    '--yes',
  ]);
}
log.info(`Deployed ${names.length} function(s): ${names.join(', ')}`);
