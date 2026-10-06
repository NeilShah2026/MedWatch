import pg from 'pg';
import type { SeedUser } from '../generate.ts';
import type { SeedWriter } from './types.ts';

const BATCH = 500;
/** text[] columns (everything else that is an object/array is jsonb). */
const TEXT_ARRAY_COLUMNS = new Set(['medications.schedule_times']);

/** Local verification writer (Postgres + the auth shim in scripts/local-pg). */
export class PgSeedWriter implements SeedWriter {
  private client: pg.Client;
  private connected = false;
  constructor(url: string) {
    this.client = new pg.Client({ connectionString: url });
  }
  private async c() {
    if (!this.connected) {
      await this.client.connect();
      this.connected = true;
    }
    return this.client;
  }

  async createUsers(users: SeedUser[]): Promise<Map<string, string>> {
    const c = await this.c();
    for (const u of users)
      await c.query('insert into auth.users (id, email) values ($1, $2)', [u.id, u.email]);
    return new Map(users.map((u) => [u.id, u.id]));
  }

  async insert(table: string, rows: Record<string, unknown>[]): Promise<void> {
    if (!rows.length) return;
    const c = await this.c();
    const cols = Object.keys(rows[0]!);
    for (let i = 0; i < rows.length; i += BATCH) {
      const chunk = rows.slice(i, i + BATCH);
      const params: unknown[] = [];
      const tuples = chunk.map((row) => {
        const ph = cols.map((col) => {
          const v = row[col];
          params.push(
            v !== null && typeof v === 'object' && !TEXT_ARRAY_COLUMNS.has(`${table}.${col}`)
              ? JSON.stringify(v)
              : v,
          );
          return `$${params.length}`;
        });
        return `(${ph.join(',')})`;
      });
      await c.query(
        `insert into public.${table} (${cols.map((x) => `"${x}"`).join(',')}) values ${tuples.join(',')}`,
        params,
      );
    }
  }

  async demoExists(orgName: string): Promise<boolean> {
    const c = await this.c();
    return (
      (await c.query('select 1 from public.organizations where name = $1', [orgName])).rowCount! > 0
    );
  }

  async wipeDemo(orgName: string, emailDomain: string): Promise<void> {
    const c = await this.c();
    await c.query('delete from public.organizations where name = $1', [orgName]);
    await c.query('delete from auth.users where email like $1', [`%@${emailDomain}`]);
  }

  async close(): Promise<void> {
    if (this.connected) await this.client.end();
  }
}
