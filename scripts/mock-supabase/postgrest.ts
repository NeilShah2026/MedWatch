import type { MockDb, Row } from './db.ts';

/** Split a PostgREST select list at top-level commas. */
function splitTop(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of s) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

const FK: Record<string, string> = {
  patients: 'patient_id',
  medications: 'medication_id',
  organizations: 'organization_id',
  profiles: 'profile_id',
};

export function project(
  db: MockDb,
  uid: string,
  table: string,
  row: Row,
  select: string | null,
): Row {
  if (!select || select === '*') return { ...row };
  const out: Row = {};
  for (const item of splitTop(select)) {
    const m = item.match(/^(\w+)\((.*)\)$/s);
    if (m) {
      const rel = m[1]!;
      const fk = FK[rel] ?? `${rel.replace(/s$/, '')}_id`;
      const target = db.t(rel).find((r) => r.id === row[fk]);
      out[rel] =
        target && db.canRead(uid, rel, target) ? project(db, uid, rel, target, m[2]!) : null;
    } else {
      out[item] = row[item] ?? null;
    }
  }
  return out;
}

function parseList(v: string): string[] {
  return v
    .replace(/^\(|\)$/g, '')
    .split(',')
    .map((x) => x.trim().replace(/^"|"$/g, ''));
}

function cmp(a: unknown, b: unknown): number {
  if (a === b) return 0;
  if (a === null || a === undefined) return 1;
  if (b === null || b === undefined) return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a) < String(b) ? -1 : 1;
}

const RESERVED = new Set(['select', 'order', 'limit', 'offset', 'on_conflict', 'columns']);

export function applyFilters(rows: Row[], params: URLSearchParams): Row[] {
  let out = rows;
  for (const [key, raw] of params.entries()) {
    if (RESERVED.has(key)) continue;
    const dot = raw.indexOf('.');
    const op = raw.slice(0, dot);
    const val = raw.slice(dot + 1);
    out = out.filter((r) => {
      const v = r[key];
      switch (op) {
        case 'eq':
          return String(v) === val;
        case 'neq':
          return String(v) !== val;
        case 'gt':
          return v !== null && v !== undefined && cmp(v, val) > 0;
        case 'gte':
          return v !== null && v !== undefined && cmp(v, val) >= 0;
        case 'lt':
          return v !== null && v !== undefined && cmp(v, val) < 0;
        case 'lte':
          return v !== null && v !== undefined && cmp(v, val) <= 0;
        case 'in':
          return parseList(val).includes(String(v));
        case 'is':
          return val === 'null' ? v === null || v === undefined : String(v) === val;
        case 'ilike':
        case 'like': {
          const re = new RegExp(
            `^${val.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/[*%]/g, '.*')}$`,
            op === 'ilike' ? 'i' : '',
          );
          return re.test(String(v ?? ''));
        }
        default:
          return true;
      }
    });
  }
  const order = params.get('order');
  if (order) {
    const keys = order.split(',').map((o) => {
      const [col, dir] = o.split('.');
      return { col: col!, desc: dir === 'desc' };
    });
    out = [...out].sort((a, b) => {
      for (const k of keys) {
        const c = cmp(a[k.col], b[k.col]);
        if (c) return k.desc ? -c : c;
      }
      return 0;
    });
  }
  const offset = Number(params.get('offset') ?? 0);
  const limit = params.get('limit');
  return out.slice(offset, limit ? offset + Number(limit) : undefined);
}
