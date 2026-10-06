#!/usr/bin/env node
// Apply migrations in supabase/migrations to the linked cloud project.
import { link, requireCliEnv, supabase } from './lib/supabase-cli.mjs';
const env = requireCliEnv();
link(env);
supabase(['db', 'push', '--password', env.SUPABASE_DB_PASSWORD, '--include-all', '--yes']);
