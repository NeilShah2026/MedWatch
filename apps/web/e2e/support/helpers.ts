import { expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { createClient } from '@supabase/supabase-js';
import { DEMO_PASSWORD, backendEnv } from './env';

export async function signIn(page: Page, email: string) {
  await page.goto('/signin');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(DEMO_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('navigation', { name: 'Main' }).first()).toBeVisible();
}

/** WCAG 2.1 AA checks with axe (spec §9). */
export async function expectAccessible(page: Page) {
  // @axe-core/playwright resolves its own playwright-core; the Page API it uses is stable.
  const results = await new AxeBuilder({
    page: page as unknown as ConstructorParameters<typeof AxeBuilder>[0]['page'],
  })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const summary = results.violations.map((v) => `${v.id}: ${v.nodes.length} node(s) — ${v.help}`);
  expect(summary).toEqual([]);
}

/** Service-role client for test setup/inspection (Node only; never in the browser bundle). */
export function adminDb() {
  return createClient(backendEnv.VITE_SUPABASE_URL!, backendEnv.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
}
