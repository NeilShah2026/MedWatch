import { expect, test } from '@playwright/test';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { backendEnv, hasBackend, users } from './support/env';
import { adminDb, signIn } from './support/helpers';
import { linkedPatientIds } from './support/data';

function cronSecret(): string | undefined {
  if (backendEnv.CRON_SECRET) return backendEnv.CRON_SECRET;
  const p = resolve(dirname(fileURLToPath(import.meta.url)), '../../../.env.functions');
  return existsSync(p) ? readFileSync(p, 'utf8').match(/^CRON_SECRET=(.*)$/m)?.[1] : undefined;
}

// E2E 4: missed dose → caregiver alert → agency escalation (job run twice: no duplicates).
test.describe('missed dose alerts', () => {
  test.skip(
    !hasBackend || !cronSecret(),
    'needs the cloud dev project with deployed functions and CRON_SECRET',
  );

  test('caregiver alert then escalation, idempotent', async ({ browser }) => {
    const db = adminDb();
    const [patientId] = await linkedPatientIds(users.caregiver1);
    const { data: med } = await db
      .from('medications')
      .select('id, organization_id')
      .eq('patient_id', patientId!)
      .eq('status', 'active')
      .eq('prn', false)
      .limit(1)
      .single();
    const at = new Date(Date.now() - 3 * 3600_000);
    at.setUTCSeconds(Math.floor(Math.random() * 59), 0);
    const { data: dose } = await db
      .from('dose_events')
      .insert({
        organization_id: med!.organization_id,
        patient_id: patientId,
        medication_id: med!.id,
        scheduled_for: at.toISOString(),
        status: 'pending',
      })
      .select('id')
      .single();

    const call = () =>
      fetch(`${backendEnv.VITE_SUPABASE_URL}/functions/v1/check-missed-doses`, {
        method: 'POST',
        headers: { 'x-cron-secret': cronSecret()!, 'content-type': 'application/json' },
        body: '{}',
      });
    expect((await call()).ok).toBe(true);
    const count = async () =>
      (
        await db
          .from('alerts')
          .select('id', { count: 'exact', head: true })
          .eq('related_id', dose!.id)
      ).count ?? 0;
    const afterFirst = await count();
    expect(afterFirst).toBeGreaterThanOrEqual(3);
    expect((await call()).ok).toBe(true);
    expect(await count()).toBe(afterFirst);
    const { data: d } = await db.from('dose_events').select('status').eq('id', dose!.id).single();
    expect(d!.status).toBe('missed');

    for (const [email, label] of [
      [users.caregiver1, 'Missed dose'],
      [users.nurse1, 'Dose still not confirmed'],
      [users.admin, 'Dose still not confirmed'],
    ] as const) {
      const page = await browser.newPage();
      await signIn(page, email);
      await page.getByTestId('alerts-bell').click();
      await expect(page.getByRole('link', { name: new RegExp(label) }).first()).toBeVisible();
      await page.close();
    }
  });
});
