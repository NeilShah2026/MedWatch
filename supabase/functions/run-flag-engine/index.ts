// run-flag-engine: hourly for all active patients (cron), or on demand for one patient after
// a symptom log or medication change (DB trigger or the web app). Idempotent.
import { getEnv } from '../_shared/deno/env.ts';
import { HttpError, json, readJson, serveHandler } from '../_shared/deno/http.ts';
import { authenticate, serviceClient } from '../_shared/deno/auth.ts';
import { runFlagEngineForPatient, selectAll } from '../_shared/jobs/runners.ts';
import { createSmsProvider } from '../_shared/sms/index.ts';
import { fnLog } from '../_shared/logger.ts';

serveHandler('run-flag-engine', async (req) => {
  const env = getEnv();
  const db = serviceClient(env);
  const caller = await authenticate(req, env, db, { allowUser: true });
  const body = await readJson(req);
  const sms = createSmsProvider(env);
  const now = new Date();
  const patientId = typeof body.patient_id === 'string' ? body.patient_id : null;

  if (patientId) {
    if (caller.kind === 'user') {
      const { data } = await caller.asUser
        .from('patients')
        .select('id')
        .eq('id', patientId)
        .maybeSingle();
      if (!data) throw new HttpError(404, 'patient_not_found');
    }
    return json(await runFlagEngineForPatient(db, patientId, sms, now));
  }
  if (caller.kind !== 'cron') throw new HttpError(403, 'cron_only');
  const patients = await selectAll<{ id: string }>((a, b) =>
    db.from('patients').select('id').eq('status', 'active').range(a, b),
  );
  const totals = { patients: patients.length, created: 0, upgraded: 0, alerts: 0, failed: 0 };
  for (const p of patients) {
    try {
      const r = await runFlagEngineForPatient(db, p.id, sms, now);
      totals.created += r.created;
      totals.upgraded += r.upgraded;
      totals.alerts += r.alerts;
    } catch {
      totals.failed++;
      fnLog.warn('flags.patient_failed', { patient_id: p.id });
    }
  }
  return json(totals);
});
