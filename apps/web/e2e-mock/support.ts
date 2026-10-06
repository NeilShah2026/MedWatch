import { expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

export const PASSWORD = 'Demo!2345';

export async function signIn(page: Page, email: string) {
  await page.goto('/signin');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('navigation', { name: 'Main' }).first()).toBeVisible();
}

export async function expectAccessible(page: Page, label = '') {
  const results = await new AxeBuilder({
    page: page as unknown as ConstructorParameters<typeof AxeBuilder>[0]['page'],
  })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const summary = results.violations.map(
    (v) => `${label} ${v.id}: ${v.nodes.length} — ${v.help} — ${v.nodes[0]?.target.join(' ')}`,
  );
  expect(summary).toEqual([]);
}

/** No error/forbidden state is showing. */
export async function expectHealthy(page: Page) {
  await expect(page.getByText('Something went wrong. Please try again.')).toHaveCount(0);
  await expect(page.getByTestId('forbidden')).toHaveCount(0);
}

export function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes('favicon')) errors.push(m.text());
  });
  return errors;
}
