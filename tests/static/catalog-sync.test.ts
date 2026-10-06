import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SYMPTOM_CATALOG } from '../../packages/core/src/catalog.ts';
import { SCHEMAS, renderSchema } from '../../scripts/gen-rule-schemas.ts';

const ROOT = resolve(__dirname, '../..');

describe('symptom catalog', () => {
  it('migration seed matches packages/core catalog exactly', () => {
    const sql = readFileSync(
      resolve(ROOT, 'supabase/migrations/20261006000005_symptom_catalog.sql'),
      'utf8',
    );
    const rows = [
      ...sql.matchAll(
        /\('([a-z_]+)', '([^']*)', '([^']*)', '([^']*)', '([a-z]+)', (true|false), (\d+)\)/g,
      ),
    ].map((m) => ({
      code: m[1],
      label: m[2],
      plain_label: m[3],
      help_text: m[4],
      category: m[5],
      is_core: m[6] === 'true',
      sort_order: Number(m[7]),
    }));
    expect(rows).toEqual([...SYMPTOM_CATALOG]);
  });
});

describe('rule JSON Schemas', () => {
  it('committed schemas are up to date (run `npm run rules:schemas`)', () => {
    for (const name of Object.keys(SCHEMAS) as (keyof typeof SCHEMAS)[]) {
      const committed = readFileSync(resolve(ROOT, 'rules/schemas', name), 'utf8');
      expect(JSON.parse(committed), name).toEqual(JSON.parse(renderSchema(name)));
    }
  });
});
