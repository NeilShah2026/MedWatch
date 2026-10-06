// check-missed-doses (every 10 minutes): marks missed doses, alerts caregivers at the grace
// period and escalates to the care team at the escalation threshold. No duplicate alerts.
import { getEnv } from '../_shared/deno/env.ts';
import { json, serveHandler } from '../_shared/deno/http.ts';
import { authenticate, serviceClient } from '../_shared/deno/auth.ts';
import { runCheckMissedDoses } from '../_shared/jobs/runners.ts';
import { createSmsProvider } from '../_shared/sms/index.ts';

serveHandler('check-missed-doses', async (req) => {
  const env = getEnv();
  const db = serviceClient(env);
  await authenticate(req, env, db, { allowUser: false });
  return json(await runCheckMissedDoses(db, createSmsProvider(env), new Date()));
});
