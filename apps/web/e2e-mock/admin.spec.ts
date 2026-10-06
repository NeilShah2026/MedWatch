import { expect, test } from '@playwright/test';
import { expectAccessible, expectHealthy, signIn, trackErrors } from './support';

// E2E 6 (mock): admin views dashboard, invites a user, exports pilot metrics; the audit log shows the export.
test('admin: dashboard, every admin page, invite, pilot export logged, add patient, settings', async ({
  page,
}) => {
  const errors = trackErrors(page);
  await signIn(page, 'admin@demo.medwatch');
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByTestId('kpis')).toBeVisible();
  await expect(page.getByTestId('needs-attention').locator('li').first()).toBeVisible();
  await expect(page.getByTestId('ai-card')).toContainText('active check-ins tailored with AI');
  await expectAccessible(page, 'dashboard');

  // Team: invite a nurse
  await page.getByRole('link', { name: 'Team' }).first().click();
  await expect(page.getByTestId('team-row').first()).toBeVisible();
  await expectAccessible(page, 'team');
  await page.getByRole('button', { name: 'Invite user' }).click();
  await page.getByRole('dialog').getByLabel('Email').fill('new.nurse@example.test');
  await page.getByRole('dialog').getByLabel('Full name').fill('New Nurse');
  await page.getByRole('dialog').getByRole('button', { name: 'Send invitation' }).click();
  await expect(page.getByText('Invitation sent.')).toBeVisible();
  await expect(page.getByTestId('invites')).toContainText('new.nurse@example.test');

  // Pilot metrics: export CSV (logged)
  await page.getByRole('link', { name: 'Pilot metrics' }).first().click();
  await expect(page.getByTestId('pilot-metrics')).toBeVisible();
  await expectAccessible(page, 'pilot');
  const download = page.waitForEvent('download');
  await page.getByTestId('export-pilot').click();
  expect((await download).suggestedFilename()).toMatch(/^pilot-metrics-.*\.csv$/);
  await page.getByRole('link', { name: 'Printable pilot report' }).click();
  await expect(page.getByTestId('pilot-report')).toContainText('MedWatch pilot report');
  await expectAccessible(page, 'pilot report');

  // Audit log shows the export
  await page.goto('/admin/audit');
  await page.getByLabel('Action').selectOption('export');
  await expect(
    page
      .locator('[data-testid="audit-row"][data-action="export"]')
      .filter({ hasText: 'pilot_metrics' })
      .first(),
  ).toBeVisible();
  await expectAccessible(page, 'audit');
  const csv = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export CSV' }).click();
  expect((await csv).suggestedFilename()).toMatch(/^audit-log-.*\.csv$/);

  // Patients: add a client with required consent
  await page.goto('/admin/patients');
  await expect(page.getByTestId('admin-patient-row').first()).toBeVisible();
  await expectAccessible(page, 'patients');
  const before = await page.getByTestId('admin-patient-row').count();
  await page.getByRole('button', { name: 'Add client' }).click();
  const form = page.getByTestId('add-patient-form');
  await form.getByLabel('First name').fill('Testy');
  await form.getByLabel('Last name').fill('Synthetic');
  await form.getByLabel('Date of birth').fill('1941-02-03');
  await form.getByRole('button', { name: 'Add client' }).click();
  await expect(
    form.getByText('Record the data-use consent before adding a client.').first(),
  ).toBeVisible();
  await form.getByLabel('Consent given by (name)').fill('Testy Synthetic');
  await form.getByLabel('I confirm the signed data-use consent is on file.').check();
  await form.getByRole('button', { name: 'Add client' }).click();
  await expect(page.getByText('Client added.')).toBeVisible();
  await expect(page.getByTestId('admin-patient-row')).toHaveCount(before + 1);

  // Manage: export JSON (logged) and discharge
  await page
    .getByTestId('admin-patient-row')
    .filter({ hasText: 'Testy Synthetic' })
    .getByRole('button', { name: 'Manage' })
    .click();
  await expectAccessible(page, 'manage');
  const json = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export all data (JSON)' }).click();
  expect((await json).suggestedFilename()).toMatch(/^client-export-.*\.json$/);
  await page.getByRole('button', { name: 'Permanently delete this client' }).click();
  await expect(page.getByRole('button', { name: 'Delete permanently' })).toBeDisabled();
  await page.getByLabel('Type DELETE to confirm').fill('DELETE');
  await page.getByRole('button', { name: 'Delete permanently' }).click();
  await expect(page.getByTestId('admin-patient-row')).toHaveCount(before);

  // Settings
  await page.goto('/admin/settings');
  await expectAccessible(page, 'settings');
  await page.getByLabel('Missed-dose grace period (minutes)').fill('45');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Settings saved.')).toBeVisible();

  // Admin can use the clinic views for any patient
  await page.goto('/clinic');
  await expect(page.getByTestId('caseload-row')).toHaveCount(25);
  await expectHealthy(page);
  await expectAccessible(page, 'all clients');
  expect(errors).toEqual([]);
});
