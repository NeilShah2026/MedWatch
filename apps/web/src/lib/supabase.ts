import { createClient } from '@supabase/supabase-js';
import { env } from './env';

/** Browser client: anon key + user session only. The service role key never reaches the browser. */
export const supabase = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});
