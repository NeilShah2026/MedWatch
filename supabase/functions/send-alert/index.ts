// send-alert: deliver alert drafts (in-app always; SMS only with opt-in + active SMS consent).
// The other jobs call the same deliverAlerts() in-process; this endpoint lets server-side
// callers (cron/pg_net) request delivery over HTTP. Never callable by end users.
import { z } from 'zod';
import { getEnv } from '../_shared/deno/env.ts';
import { HttpError, json, readJson, serveHandler } from '../_shared/deno/http.ts';
import { authenticate, serviceClient } from '../_shared/deno/auth.ts';
import { deliverAlerts } from '../_shared/jobs/runners.ts';
import { createSmsProvider } from '../_shared/sms/index.ts';

const schema = z.object({
  alerts: z
    .array(
      z.object({
        organization_id: z.string().uuid(),
        patient_id: z.string().uuid(),
        recipient_profile_id: z.string().uuid(),
        alert_type: z.enum(['missed_dose', 'flag', 'escalation']),
        related_id: z.string().uuid(),
      }),
    )
    .max(500),
});

serveHandler('send-alert', async (req) => {
  const env = getEnv();
  const db = serviceClient(env);
  await authenticate(req, env, db, { allowUser: false });
  const parsed = schema.safeParse(await readJson(req));
  if (!parsed.success) throw new HttpError(400, 'invalid_request');
  return json(await deliverAlerts(db, parsed.data.alerts, createSmsProvider(env)));
});
