// Generates rules/schemas/*.schema.json from the Zod schemas in packages/core (the runtime
// source of truth), so editors can validate rule files while a clinician edits them.
// Run: npm run rules:schemas   (a test fails if the committed files are stale)
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zodToJsonSchema } from 'zod-to-json-schema';
import {
  drugClassesFileSchema,
  interactionsFileSchema,
  medicationRisksFileSchema,
  sideEffectsFileSchema,
} from '../packages/core/src/rules/schemas.ts';

export const SCHEMAS = {
  'drug_classes.schema.json': drugClassesFileSchema,
  'medication_risks.schema.json': medicationRisksFileSchema,
  'interactions.schema.json': interactionsFileSchema,
  'side_effect_associations.schema.json': sideEffectsFileSchema,
} as const;

export function renderSchema(name: keyof typeof SCHEMAS): string {
  const schema = zodToJsonSchema(SCHEMAS[name], {
    name: name.replace('.schema.json', ''),
    $refStrategy: 'none',
  });
  return JSON.stringify(schema, null, 2) + '\n';
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  for (const name of Object.keys(SCHEMAS) as (keyof typeof SCHEMAS)[]) {
    writeFileSync(resolve(import.meta.dirname, '../rules/schemas', name), renderSchema(name));
  }
  process.stdout.write('rules/schemas updated\n');
}
