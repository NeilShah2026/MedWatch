// generate-doses (hourly): creates today's and tomorrow's missing dose_events for orgs whose
// local time just passed midnight. Idempotent (unique (medication_id, scheduled_for)).
import { getEnv } from '../_shared/deno/env.ts';
import { json, readJson, serveHandler } from '../_shared/deno/http.ts';
import { authenticate, requireRole, serviceClient } from '../_shared/deno/auth.ts';
import { runGenerateDoses } from '../_shared/jobs/runners.ts';

serveHandler('generate-doses', async (req) => {
  const env = getEnv();
  const db = serviceClient(env);
  const caller = await authenticate(req, env, db, { allowUser: true });
  if (caller.kind === 'user') requireRole(caller, ['agency_admin']);
  const body = await readJson(req);
  return json(
    await runGenerateDoses(db, new Date(), { all: body.all === true || caller.kind === 'user' }),
  );
});
