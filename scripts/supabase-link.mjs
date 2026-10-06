#!/usr/bin/env node
import { link, requireCliEnv } from './lib/supabase-cli.mjs';
link(requireCliEnv());
