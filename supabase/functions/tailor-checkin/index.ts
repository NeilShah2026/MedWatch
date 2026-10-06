// tailor-checkin: build or refresh a patient's tailored daily check-in (spec §7.5, §8).
// Triggers: medication change (pg_net trigger or the web app after a save), a nurse's
// "Regenerate" (force), and a nightly sweep for patients without a current template.
import { SYMPTOM_CATALOG, getBundledRules } from '../../../packages/core/src/index.ts';
import { getEnv } from '../_shared/deno/env.ts';
import { HttpError, json, readJson, serveHandler } from '../_shared/deno/http.ts';
import { authenticate, serviceClient } from '../_shared/deno/auth.ts';
import { createAiProvider } from '../_shared/ai/index.ts';
import { tailorCheckin } from '../_shared/tailor/tailor.ts';
import { SupabaseTailorStore } from '../_shared/tailor/supabase-store.ts';
import { fnLog } from '../_shared/logger.ts';

const SWEEP_LIMIT = 300;

serveHandler('tailor-checkin', async (req) => {
  const env = getEnv();
  const db = serviceClient(env);
  const caller = await authenticate(req, env, db, { allowUser: true });
  const body = await readJson(req);
  const deps = {
    store: new SupabaseTailorStore(db),
    provider: createAiProvider(env),
    catalog: SYMPTOM_CATALOG,
    rules: getBundledRules(),
  };

  if (body.sweep === true) {
    if (caller.kind !== 'cron') throw new HttpError(403, 'cron_only');
    const { data: patients } = await db
      .from('patients')
      .select('id')
      .eq('status', 'active')
      .limit(SWEEP_LIMIT);
    let saved = 0;
    for (const p of patients ?? []) {
      try {
        const r = await tailorCheckin(p.id, deps);
        if (r.status === 'saved') saved++;
      } catch {
        fnLog.warn('tailor.sweep_patient_failed', { patient_id: p.id });
      }
    }
    return json({ checked: patients?.length ?? 0, saved });
  }

  const patientId = typeof body.patient_id === 'string' ? body.patient_id : null;
  if (!patientId) throw new HttpError(400, 'patient_id_required');
  let force = false;
  if (caller.kind === 'user') {
    // RLS decides whether this user may touch the patient.
    const { data: visible } = await caller.asUser
      .from('patients')
      .select('id')
      .eq('id', patientId)
      .maybeSingle();
    if (!visible) throw new HttpError(404, 'patient_not_found');
    force = body.force === true && (caller.role === 'nurse' || caller.role === 'agency_admin');
  }
  const result = await tailorCheckin(patientId, deps, { force });
  fnLog.info('tailor.result', {
    patient_id: patientId,
    status: result.status,
    source: 'source' in result ? result.source : null,
  });
  return json(result);
});
