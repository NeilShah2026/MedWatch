import { expect, test } from '@playwright/test';
import { signIn } from './support';

const API = 'http://localhost:54399';

// E2E 4 (mock): missed dose → caregiver alert → agency escalation; job is idempotent.
test('missed dose alerts the caregiver, then escalates; running twice adds nothing', async ({
  browser,
}) => {
  const { stories } = (await (await fetch(`${API}/__seed`)).json()) as {
    stories: Record<string, string>;
  };
  const patientId = stories.story1!;
  const { id: doseId } = (await (
    await fetch(`${API}/__test/pending-dose`, {
      method: 'POST',
      body: JSON.stringify({ patient_id: patientId, hours_ago: 3 }),
    })
  ).json()) as { id: string };
  const run = async () =>
    (await (
      await fetch(`${API}/functions/v1/check-missed-doses`, {
        method: 'POST',
        headers: { 'x-cron-secret': 'mock-cron' },
      })
    ).json()) as { alerts: number };
  const first = await run();
  expect(first.alerts).toBeGreaterThanOrEqual(3); // caregiver + nurse + admin for this dose
  expect((await run()).alerts).toBe(0);
  expect(doseId).toBeTruthy();

  for (const [email, label] of [
    ['caregiver1@demo.medwatch', 'Missed dose'],
    ['nurse1@demo.medwatch', 'Dose still not confirmed'],
    ['admin@demo.medwatch', 'Dose still not confirmed'],
  ] as const) {
    const page = await browser.newPage();
    await signIn(page, email);
    await page.getByTestId('alerts-bell').click();
    await expect(page.getByRole('link', { name: new RegExp(label) }).first()).toBeVisible();
    await page.close();
  }
});
