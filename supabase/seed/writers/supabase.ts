import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { SeedUser } from '../generate.ts';
import type { SeedWriter } from './types.ts';

const BATCH = 500;

export class SupabaseSeedWriter implements SeedWriter {
  private db: SupabaseClient;
  constructor(url: string, serviceRoleKey: string) {
    this.db = createClient(url, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }

  async createUsers(users: SeedUser[]): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    for (const u of users) {
      const { data, error } = await this.db.auth.admin.createUser({
        id: u.id,
        email: u.email,
        password: u.password,
        email_confirm: true,
        user_metadata: { demo: true },
      } as Parameters<SupabaseClient['auth']['admin']['createUser']>[0]);
      if (error) throw new Error(`createUser failed for a demo account: ${error.message}`);
      map.set(u.id, data.user.id);
    }
    return map;
  }

  async insert(table: string, rows: Record<string, unknown>[]): Promise<void> {
    for (let i = 0; i < rows.length; i += BATCH) {
      const { error } = await this.db.from(table).insert(rows.slice(i, i + BATCH));
      if (error) throw new Error(`insert into ${table} failed: ${error.message}`);
    }
  }

  async demoExists(orgName: string): Promise<boolean> {
    const { data, error } = await this.db.from('organizations').select('id').eq('name', orgName);
    if (error) throw new Error(`could not query organizations: ${error.message}`);
    return (data ?? []).length > 0;
  }

  async wipeDemo(orgName: string, emailDomain: string): Promise<void> {
    const { error } = await this.db.from('organizations').delete().eq('name', orgName);
    if (error) throw new Error(`could not delete demo organization: ${error.message}`);
    for (let page = 1; ; page++) {
      const { data, error: e } = await this.db.auth.admin.listUsers({ page, perPage: 200 });
      if (e) throw new Error(`listUsers failed: ${e.message}`);
      const demo = data.users.filter((u) => u.email?.endsWith(`@${emailDomain}`));
      for (const u of demo) {
        const { error: de } = await this.db.auth.admin.deleteUser(u.id);
        if (de) throw new Error(`deleteUser failed: ${de.message}`);
      }
      if (data.users.length < 200) break;
      if (demo.length) page--; // deleted users shift later pages
    }
  }

  async close(): Promise<void> {}
}
