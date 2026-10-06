/**
 * Hard Rule 4 / spec §11 "PHI logging test": no direct console calls outside the ID-only
 * logger modules, and the logger's field type only admits ID-like keys. ESLint `no-console`
 * enforces the same rule at lint time; this test makes it part of `npm run test`.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const ROOT = resolve(__dirname, '../..');
const ALLOWED = new Set([
  'apps/web/src/lib/logger.ts',
  'supabase/functions/_shared/logger.ts',
  'supabase/seed/log.ts',
  'scripts/lib/log.mjs',
]);

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.(ts|tsx|mjs|js)$/.test(name) && !/\.test\.ts$/.test(name)) out.push(p);
  }
  return out;
}

describe('no PHI in logs', () => {
  const files = [
    'apps/web/src',
    'packages/core/src',
    'supabase/functions',
    'supabase/seed',
    'scripts',
  ]
    .flatMap((d) => walk(join(ROOT, d)))
    .filter((f) => !ALLOWED.has(relative(ROOT, f)));

  it('no console.* calls outside the safe loggers', () => {
    const hits = files.filter((f) =>
      /\bconsole\s*\.\s*(log|info|warn|error|debug|trace)\s*\(/.test(readFileSync(f, 'utf8')),
    );
    expect(hits.map((f) => relative(ROOT, f))).toEqual([]);
  });

  it('the web logger restricts fields to IDs and coarse metadata', () => {
    const src = readFileSync(join(ROOT, 'apps/web/src/lib/logger.ts'), 'utf8');
    expect(src).toMatch(/type SafeKey = `\$\{string\}Id`/);
  });

  it('no patient fields are interpolated into logger calls', () => {
    const phiField =
      /logger\.\w+\([^)]*\b(first_name|last_name|full_name|date_of_birth|free_text|notes|entries|question_text|explanation)\b/;
    const hits = files.filter((f) => phiField.test(readFileSync(f, 'utf8')));
    expect(hits.map((f) => relative(ROOT, f))).toEqual([]);
  });
});
