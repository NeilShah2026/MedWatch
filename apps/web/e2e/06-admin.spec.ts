import { expect, test } from '@playwright/test';
import { hasBackend, users } from './support/env';
import { adminDb, expectAccessible, signIn } from './support/helpers';

// E2E 6: admin views dashboard, invites a user, exports pilot metrics; audit log shows the export.
test.describe('admin', () => {
  test.skip(!hasBackend, 'needs the cloud dev project (see PROGRESS.md)');

  test('dashboard, invite, pilot export appears in the audit log', async ({ page }) => {
    await signIn(page, users.admin);
    await expect(page.getByTestId('kpis')).toBeVisible();
    await expect(page.getByTestId('needs-attention')).toBeVisible();
    await expectAccessible(page);

    const email = `invitee.${Date.now()}@example.test`;
    await page.getByRole('link', { name: 'Team' }).first().click();
    await page.getByRole('button', { name: 'Invite user' }).click();
    await page.getByRole('dialog').getByLabel('Email').fill(email);
    await page.getByRole('dialog').getByRole('button', { name: 'Send invitation' }).click();
    await expect(page.getByText('Invitation sent.')).toBeVisible();
    await expect(page.getByTestId('invites')).toContainText(email);
    await expectAccessible(page);

    await page.getByRole('link', { name: 'Pilot metrics' }).first().click();
    await expect(page.getByTestId('pilot-metrics')).toBeVisible();
    const download = page.waitForEvent('download');
    await page.getByTestId('export-pilot').click();
    expect((await download).suggestedFilename()).toMatch(/^pilot-metrics-.*\.csv$/);

    await page.goto('/admin/audit');
    await page.getByLabel('Action').selectOption('export');
    await expect(
      page
        .locator('[data-testid="audit-row"][data-action="export"]')
        .filter({ hasText: 'pilot_metrics' })
        .first(),
    ).toBeVisible();
    await expectAccessible(page);

    // cleanup: remove the test invitation and its auth user
    const db = adminDb();
    await db.from('invitations').delete().eq('email', email);
    const { data } = await db.auth.admin.listUsers({ perPage: 200 });
    const u = data.users.find((x) => x.email === email);
    if (u) await db.auth.admin.deleteUser(u.id);
  });

  test('every admin page passes axe', async ({ page }) => {
    await signIn(page, users.admin);
    for (const path of [
      '/admin',
      '/admin/patients',
      '/admin/team',
      '/admin/settings',
      '/admin/audit',
      '/admin/pilot',
      '/clinic',
      '/clinic/flags',
    ]) {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
      await expectAccessible(page);
    }
  });
});
