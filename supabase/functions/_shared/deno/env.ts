import { z } from 'zod';

const schema = z
  .object({
    SUPABASE_URL: z.string().url(),
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
    // Injected automatically by Supabase; used for user-scoped (RLS) clients.
    SUPABASE_ANON_KEY: z.string().min(20),
    CRON_SECRET: z.string().min(16),
    APP_ENV: z.enum(['local', 'development', 'staging', 'production']).default('development'),
    APP_URL: z.string().url().default('http://localhost:5173'),
    AI_ENABLED: z.enum(['true', 'false']).default('false'),
    AI_PROVIDER: z.enum(['gateway', 'mock']).default('mock'),
    AI_GATEWAY_URL: z.string().url().optional(),
    AI_GATEWAY_API_KEY: z.string().optional(),
    AI_GATEWAY_AUTH_HEADER: z.string().default('x-api-key'),
    AI_MODEL: z.string().default('claude-sonnet-5-5'),
    SMS_PROVIDER: z.enum(['console', 'twilio']).default('console'),
    TWILIO_ACCOUNT_SID: z.string().optional(),
    TWILIO_AUTH_TOKEN: z.string().optional(),
    TWILIO_FROM_NUMBER: z.string().optional(),
  })
  .superRefine((v, ctx) => {
    if (
      v.AI_ENABLED === 'true' &&
      v.AI_PROVIDER === 'gateway' &&
      (!v.AI_GATEWAY_URL || !v.AI_GATEWAY_API_KEY)
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['AI_GATEWAY_URL'],
        message: 'AI_GATEWAY_URL and AI_GATEWAY_API_KEY are required for the gateway provider',
      });
    }
  });

export type FnEnv = z.infer<typeof schema>;

let cached: FnEnv | null = null;

/** Validate function secrets once; throws listing every missing/invalid variable by name. */
export function getEnv(): FnEnv {
  if (cached) return cached;
  const raw: Record<string, string | undefined> = {};
  for (const key of Object.keys(schema._def.schema.shape))
    raw[key] = Deno.env.get(key) || undefined;
  const r = schema.safeParse(raw);
  if (!r.success) {
    throw new Error(
      `Missing or invalid function secrets: ${r.error.issues.map((i) => i.path.join('.')).join(', ')}`,
    );
  }
  cached = r.data;
  return cached;
}
