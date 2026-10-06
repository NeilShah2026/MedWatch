import { TABLE_ORDER, generateSeed, summarize, type SeedData } from './generate.ts';
import { DEMO_EMAIL_DOMAIN, DEMO_ORG_NAME } from './fixtures.ts';
import { remapIds, type SeedWriter } from './writers/types.ts';

export interface RunOptions {
  mode: 'seed' | 'reset';
  now?: Date | string;
  log?: (msg: string) => void;
}

/** Write the demo dataset with any writer. `reset` wipes the demo org and users first. */
export async function runSeed(writer: SeedWriter, opts: RunOptions): Promise<SeedData> {
  const log = opts.log ?? (() => {});
  if (opts.mode === 'reset') {
    log('Wiping demo organization and demo users…');
    await writer.wipeDemo(DEMO_ORG_NAME, DEMO_EMAIL_DOMAIN);
  } else if (await writer.demoExists(DEMO_ORG_NAME)) {
    throw new Error(
      'The demo organization already exists. Run `npm run db:reset -- --yes` to replace it.',
    );
  }
  const generated = generateSeed({ now: opts.now });
  log('Creating demo users…');
  const idMap = await writer.createUsers(generated.users);
  const data = remapIds(generated, idMap);
  for (const table of TABLE_ORDER) {
    const rows = data.tables[table];
    log(`  ${table}: ${rows.length}`);
    await writer.insert(table, rows);
  }
  log('');
  log(summarize(data));
  return data;
}
