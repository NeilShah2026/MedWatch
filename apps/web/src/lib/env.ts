import { z } from 'zod';

const schema = z.object({
  VITE_SUPABASE_URL: z.string().url(),
  VITE_SUPABASE_ANON_KEY: z.string().min(20),
  VITE_APP_ENV: z.enum(['local', 'development', 'staging', 'production']).default('development'),
});

export type WebEnv = z.infer<typeof schema>;

const parsed = schema.safeParse({
  VITE_SUPABASE_URL: import.meta.env.VITE_SUPABASE_URL,
  VITE_SUPABASE_ANON_KEY: import.meta.env.VITE_SUPABASE_ANON_KEY,
  VITE_APP_ENV: import.meta.env.VITE_APP_ENV || undefined,
});

/** Names of variables that are missing or invalid (rendered by ConfigError). */
export const envProblems: string[] = parsed.success
  ? []
  : parsed.error.issues.map((i) => i.path.join('.'));

export const env: WebEnv = parsed.success
  ? parsed.data
  : {
      VITE_SUPABASE_URL: 'http://invalid.localhost',
      VITE_SUPABASE_ANON_KEY: 'missing-anon-key-placeholder',
      VITE_APP_ENV: 'development',
    };

export const isProduction = env.VITE_APP_ENV === 'production';
