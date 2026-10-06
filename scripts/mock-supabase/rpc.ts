import { addDays, localDate, startOfLocalDay } from '../../packages/core/src/index.ts';
import type { MockDb, Row } from './db.ts';

const TZ = 'America/New_York';
const counted = (d: Row) =>
  ['given', 'missed', 'refused'].includes(d.status as string) ||
  (d.status === 'skipped' && !String(d.note ?? '').trim());

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}
const round = (x: number, d = 4) => Math.round(x * 10 ** d) / 10 ** d;

export function rpc(db: MockDb, uid: string, fn: string, args: Record<string, unknown>): unknown {
  const visible = (t: string) => db.t(t).filter((r) => db.canRead(uid, t, r));
  const now = Date.now();
  const today = localDate(now, TZ);
  switch (fn) {
    case 'log_login':
      db.audit(uid, 'login', 'profile', uid);
      return null;
    case 'log_view':
      db.audit(uid, 'view', String(args.p_entity_type), (args.p_entity_id as string) ?? null);
      return null;
    case 'log_export': {
      const d = (args.p_details ?? {}) as Row;
      db.audit(uid, 'export', String(args.p_entity_type), (args.p_entity_id as string) ?? null, {
        format: d.format,
        rows: d.rows,
        from: d.from,
        to: d.to,
      });
      return null;
    }
    case 'org_today':
      return today;
    case 'patient_overview': {
      const flags = visible('flags');
      const doses = visible('dose_events');
      const logs = visible('symptom_logs');
      const dayStart = startOfLocalDay(today, TZ).getTime();
      const dayEnd = startOfLocalDay(addDays(today, 1), TZ).getTime();
      return visible('patients').map((p) => {
        const f = flags.filter((x) => x.patient_id === p.id && x.status === 'open');
        const week = doses.filter(
          (d) =>
            d.patient_id === p.id &&
            Date.parse(d.scheduled_for as string) >= now - 7 * 864e5 &&
            Date.parse(d.scheduled_for as string) <= now,
        );
        const given = week.filter((d) => d.status === 'given').length;
        const total = week.filter(counted).length;
        const pl = logs
          .filter((l) => l.patient_id === p.id)
          .map((l) => l.logged_for_date as string)
          .sort();
        const td = doses.filter(
          (d) =>
            d.patient_id === p.id &&
            Date.parse(d.scheduled_for as string) >= dayStart &&
            Date.parse(d.scheduled_for as string) < dayEnd,
        );
        return {
          patient_id: p.id,
          first_name: p.first_name,
          last_name: p.last_name,
          date_of_birth: p.date_of_birth,
          primary_nurse_id: p.primary_nurse_id,
          status: p.status,
          last_visit_at: p.last_visit_at,
          open_high: f.filter((x) => x.severity === 'high').length,
          open_medium: f.filter((x) => x.severity === 'medium').length,
          open_low: f.filter((x) => x.severity === 'low').length,
          adherence_7d: total ? round(given / total) : null,
          given_7d: given,
          total_7d: total,
          last_checkin: pl.at(-1) ?? null,
          checkin_today: pl.at(-1) === today,
          doses_today_done: td.filter((d) =>
            ['given', 'refused', 'skipped'].includes(d.status as string),
          ).length,
          doses_today_total: td.length,
        };
      });
    }
    case 'adherence_daily': {
      const from = String(args.p_start);
      const to = String(args.p_end);
      const byDay = new Map<string, Row>();
      for (const d of visible('dose_events').filter((x) => x.patient_id === args.p_patient_id)) {
        const day = localDate(d.scheduled_for as string, TZ);
        if (day < from || day > to) continue;
        const r = byDay.get(day) ?? {
          day,
          given: 0,
          missed: 0,
          refused: 0,
          skipped: 0,
          pending: 0,
        };
        r[d.status as string] = (r[d.status as string] as number) + 1;
        byDay.set(day, r);
      }
      return [...byDay.values()].sort((a, b) => String(a.day).localeCompare(String(b.day)));
    }
    case 'org_adherence_daily': {
      const byDay = new Map<string, { day: string; given: number; counted: number }>();
      for (const d of visible('dose_events')) {
        if (Date.parse(d.scheduled_for as string) > now) continue;
        const day = localDate(d.scheduled_for as string, TZ);
        if (day < String(args.p_start) || day > String(args.p_end)) continue;
        const r = byDay.get(day) ?? { day, given: 0, counted: 0 };
        if (d.status === 'given') r.given++;
        if (counted(d)) r.counted++;
        byDay.set(day, r);
      }
      return [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day));
    }
    case 'flags_weekly': {
      const weekOf = (iso: string) => {
        const d = localDate(iso, TZ);
        const dow = (new Date(`${d}T12:00:00Z`).getUTCDay() + 6) % 7;
        return addDays(d, -dow);
      };
      const start = weekOf(`${String(args.p_start)}T12:00:00Z`);
      const flags = visible('flags');
      const out = [];
      for (let w = start; w <= String(args.p_end); w = addDays(w, 7)) {
        out.push({
          week_start: w,
          created: flags.filter((f) => weekOf(f.created_at as string) === w).length,
          reviewed: flags.filter((f) => f.reviewed_at && weekOf(f.reviewed_at as string) === w)
            .length,
        });
      }
      return out;
    }
    case 'dashboard_kpis': {
      const active = visible('patients').filter((p) => p.status === 'active');
      const ids = new Set(active.map((p) => p.id));
      const week = visible('dose_events').filter(
        (d) =>
          ids.has(d.patient_id as string) &&
          Date.parse(d.scheduled_for as string) >= now - 7 * 864e5 &&
          Date.parse(d.scheduled_for as string) <= now,
      );
      const given = week.filter((d) => d.status === 'given').length;
      const total = week.filter(counted).length;
      const open = visible('flags').filter((f) => f.status === 'open');
      const reviewed = visible('flags').filter(
        (f) => f.reviewed_at && Date.parse(f.reviewed_at as string) >= now - 30 * 864e5,
      );
      const med = median(
        reviewed.map(
          (f) => (Date.parse(f.reviewed_at as string) - Date.parse(f.created_at as string)) / 36e5,
        ),
      );
      const done = visible('symptom_logs').filter(
        (l) =>
          ids.has(l.patient_id as string) &&
          (l.logged_for_date as string) >= addDays(today, -7) &&
          (l.logged_for_date as string) <= addDays(today, -1),
      ).length;
      return {
        active_patients: active.length,
        adherence_7d: { given, total, rate: total ? round(given / total) : null },
        open_flags: {
          high: open.filter((f) => f.severity === 'high').length,
          medium: open.filter((f) => f.severity === 'medium').length,
          low: open.filter((f) => f.severity === 'low').length,
        },
        median_review_hours_30d: med === null ? null : round(med, 1),
        reviewed_30d: reviewed.length,
        checkin_completion_7d: {
          done,
          expected: active.length * 7,
          rate: active.length ? round(done / (active.length * 7)) : null,
        },
      };
    }
    case 'needs_attention': {
      const flags = visible('flags');
      const alerts = visible('alerts');
      const logs = visible('symptom_logs');
      return visible('patients')
        .filter((p) => p.status === 'active')
        .map((p) => {
          const last =
            logs
              .filter((l) => l.patient_id === p.id)
              .map((l) => l.logged_for_date as string)
              .sort()
              .at(-1) ?? null;
          return {
            patient_id: p.id,
            first_name: p.first_name,
            last_name: p.last_name,
            high_flags: flags.filter(
              (f) => f.patient_id === p.id && f.status === 'open' && f.severity === 'high',
            ).length,
            escalations_24h: new Set(
              alerts
                .filter(
                  (a) =>
                    a.patient_id === p.id &&
                    a.alert_type === 'escalation' &&
                    Date.parse(a.sent_at as string) >= now - 864e5,
                )
                .map((a) => a.related_id),
            ).size,
            last_checkin: last,
            missing_checkin: !last || last < addDays(today, -1),
          };
        })
        .filter((r) => r.high_flags || r.escalations_24h || r.missing_checkin)
        .sort((a, b) => b.high_flags - a.high_flags || b.escalations_24h - a.escalations_24h);
    }
    case 'pilot_metrics': {
      if (!db.isAdmin(uid)) throw Object.assign(new Error('admins only'), { code: '42501' });
      const from = startOfLocalDay(String(args.p_start), TZ).getTime();
      const to = startOfLocalDay(addDays(String(args.p_end), 1), TZ).getTime();
      const inR = (iso: unknown) =>
        typeof iso === 'string' && Date.parse(iso) >= from && Date.parse(iso) < to;
      const flags = visible('flags');
      const created = flags.filter((f) => inR(f.created_at));
      const reviewed = flags.filter((f) => inR(f.reviewed_at));
      const groups = new Map<string, number>();
      for (const f of created)
        groups.set(
          `${f.flag_type}|${f.severity}`,
          (groups.get(`${f.flag_type}|${f.severity}`) ?? 0) + 1,
        );
      const doses = visible('dose_events').filter(
        (d) => inR(d.scheduled_for) && Date.parse(d.scheduled_for as string) <= now,
      );
      const given = doses.filter((d) => d.status === 'given').length;
      const total = doses.filter(counted).length;
      const days = Math.round((to - from) / 864e5);
      const activeN = visible('patients').filter((p) => p.status === 'active').length;
      const done = visible('symptom_logs').filter(
        (l) =>
          (l.logged_for_date as string) >= String(args.p_start) &&
          (l.logged_for_date as string) <= String(args.p_end),
      ).length;
      const med = median(
        reviewed.map(
          (f) => (Date.parse(f.reviewed_at as string) - Date.parse(f.created_at as string)) / 36e5,
        ),
      );
      return {
        from: args.p_start,
        to: args.p_end,
        flags_by_type_severity: [...groups.entries()].map(([k, n]) => ({
          flag_type: k.split('|')[0],
          severity: k.split('|')[1],
          count: n,
        })),
        flags_created: created.length,
        flags_reviewed: reviewed.length,
        median_review_hours: med === null ? null : round(med, 1),
        flags_escalated: reviewed.filter((f) => f.status === 'escalated').length,
        adherence: { given, total, rate: total ? round(given / total) : null },
        checkin_completion: {
          done,
          expected: activeN * days,
          rate: activeN ? round(done / (activeN * days)) : null,
        },
        missed_dose_alerts: visible('alerts').filter(
          (a) => a.alert_type === 'missed_dose' && inR(a.sent_at),
        ).length,
        escalation_alerts: visible('alerts').filter(
          (a) => a.alert_type === 'escalation' && inR(a.sent_at),
        ).length,
      };
    }
    case 'ai_checkin_stats': {
      const t = visible('checkin_templates').filter((x) => x.status === 'active');
      const ai = visible('ai_requests').filter(
        (r) => Date.parse(r.created_at as string) >= now - 7 * 864e5,
      );
      return {
        active_templates: {
          ai: t.filter((x) => x.source === 'ai').length,
          rules: t.filter((x) => x.source === 'rules').length,
          default: t.filter((x) => x.source === 'default').length,
        },
        ai_requests_7d: ai.length,
        ai_failures_7d: ai.filter((r) => r.status !== 'success').length,
      };
    }
    default:
      throw Object.assign(new Error(`unknown rpc ${fn}`), { code: 'PGRST202' });
  }
}
