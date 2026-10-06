import { describe, expect, it } from 'vitest';
import { zonedTimeToUtc, type DoseEvent, type Medication } from '../../packages/core/src/index.ts';
import {
  alertKey,
  isLocalMidnightHour,
  planDeliveries,
  planDoseGeneration,
  planFlagAlerts,
  planMissedDoses,
  type AlertDraft,
  type CareTeam,
  type ExistingAlert,
} from '../../supabase/functions/_shared/jobs/planners.ts';
import {
  ConsoleSmsProvider,
  SMS_BODY,
  TwilioSmsProvider,
  createSmsProvider,
} from '../../supabase/functions/_shared/sms/index.ts';
import { findBannedPhrases } from '../../packages/core/src/wording.ts';

const TZ = 'America/New_York';
const ORG = 'org-1';
const settings = { missed_dose_grace_minutes: 60, agency_escalation_minutes: 120 };
const med = (id: string, o: Partial<Medication> = {}): Medication => ({
  id,
  organization_id: ORG,
  patient_id: 'p1',
  name: id,
  schedule_times: ['08:00', '20:00'],
  prn: false,
  start_date: '2026-01-01',
  status: 'active',
  ...o,
});
const teams = new Map<string, CareTeam>([['p1', { caregivers: ['cg1'], nurses: ['n1'] }]]);

describe('generate-doses', () => {
  it('runs in the hour after local midnight only', () => {
    expect(isLocalMidnightHour(TZ, new Date('2026-03-20T04:30:00Z'))).toBe(true); // 00:30 EDT
    expect(isLocalMidnightHour(TZ, new Date('2026-03-20T05:30:00Z'))).toBe(false);
  });
  it('plans today + tomorrow and is idempotent (second run: nothing)', () => {
    const now = new Date('2026-03-20T04:10:00Z');
    const first = planDoseGeneration([med('a'), med('b', { prn: true })], TZ, now, new Set());
    expect(first).toHaveLength(4);
    const existing = new Set(first.map((d) => `${d.medication_id}|${d.scheduled_for}`));
    expect(planDoseGeneration([med('a')], TZ, now, existing)).toEqual([]);
  });
});

describe('check-missed-doses', () => {
  const now = new Date('2026-03-20T15:30:00Z'); // 11:30 EDT
  const due = zonedTimeToUtc('2026-03-20', '08:00', TZ).toISOString(); // 3.5h ago
  const dose = (
    id: string,
    status: DoseEvent['status'],
    at = due,
    medication_id = 'a',
  ): DoseEvent => ({ id, patient_id: 'p1', medication_id, scheduled_for: at, status });
  const input = (doses: DoseEvent[], existingAlerts: ExistingAlert[] = []) => ({
    doses,
    medications: [med('a'), med('gone', { status: 'stopped' as const, end_date: '2026-03-19' })],
    organizationId: ORG,
    timezone: TZ,
    settings,
    teams,
    admins: ['admin1'],
    existingAlerts,
    now,
  });

  it('marks missed, alerts the caregiver and escalates to nurse + admins', () => {
    const plan = planMissedDoses(input([dose('d1', 'pending')]));
    expect(plan.markMissed).toEqual(['d1']);
    expect(plan.alerts.map((a) => `${a.alert_type}:${a.recipient_profile_id}`).sort()).toEqual([
      'escalation:admin1',
      'escalation:n1',
      'missed_dose:cg1',
    ]);
  });

  it('only alerts the caregiver between grace and escalation', () => {
    const at = new Date(now.getTime() - 90 * 60_000).toISOString();
    const plan = planMissedDoses(input([dose('d1', 'pending', at)]));
    expect(plan.alerts.map((a) => a.alert_type)).toEqual(['missed_dose']);
  });

  it('is idempotent: applying the plan and re-running produces nothing new', () => {
    const first = planMissedDoses(input([dose('d1', 'pending')]));
    const existing = first.alerts.map((a) => ({
      recipient_profile_id: a.recipient_profile_id,
      alert_type: a.alert_type,
      related_id: a.related_id,
    }));
    const second = planMissedDoses(input([dose('d1', 'missed')], existing));
    expect(second).toEqual({ markMissed: [], markStopped: [], alerts: [] });
  });

  it('skips pending doses of medicines that were stopped', () => {
    const plan = planMissedDoses(input([dose('d2', 'pending', due, 'gone')]));
    expect(plan.markStopped).toEqual(['d2']);
    expect(plan.alerts).toEqual([]);
  });

  it('never alerts for confirmed doses', () => {
    expect(planMissedDoses(input([dose('d3', 'given')])).alerts).toEqual([]);
  });
});

describe('flag alerts', () => {
  const f = (id: string, severity: 'low' | 'medium' | 'high') => ({
    id,
    organization_id: ORG,
    patient_id: 'p1',
    severity,
  });
  it('alerts the nurses for flags at or above the threshold, once', () => {
    const a = planFlagAlerts(
      [f('f1', 'low'), f('f2', 'medium'), f('f3', 'high')],
      'medium',
      teams,
      [],
    );
    expect(a.map((x) => x.related_id)).toEqual(['f2', 'f3']);
    expect(planFlagAlerts([f('f2', 'medium')], 'medium', teams, a)).toEqual([]);
    expect(planFlagAlerts([f('f3', 'high')], 'high', teams, []).map((x) => x.related_id)).toEqual([
      'f3',
    ]);
  });
});

describe('send-alert delivery planning', () => {
  const alert: AlertDraft = {
    organization_id: ORG,
    patient_id: 'p1',
    recipient_profile_id: 'cg1',
    alert_type: 'missed_dose',
    related_id: 'd1',
  };
  const recips = (o: Partial<{ phone: string | null; sms_opt_in: boolean }>) =>
    new Map([['cg1', { id: 'cg1', phone: '555-0101', sms_opt_in: true, ...o }]]);
  it('always delivers in-app; SMS needs opt-in + phone + active SMS consent', () => {
    expect(planDeliveries([alert], recips({}), new Set(['p1'])).sms).toHaveLength(1);
    expect(planDeliveries([alert], recips({ sms_opt_in: false }), new Set(['p1'])).sms).toEqual([]);
    expect(planDeliveries([alert], recips({ phone: null }), new Set(['p1'])).sms).toEqual([]);
    expect(planDeliveries([alert], recips({}), new Set()).sms).toEqual([]);
    expect(planDeliveries([alert], recips({}), new Set()).inApp).toHaveLength(1);
  });
  it('does not resend what was already delivered', () => {
    const existing = [
      { ...alert, channel: 'in_app' as const },
      { ...alert, channel: 'sms' as const },
    ];
    expect(planDeliveries([alert], recips({}), new Set(['p1']), existing)).toEqual({
      inApp: [],
      sms: [],
    });
    expect(alertKey(alert)).toBe('cg1|missed_dose|d1');
  });
});

describe('SMS providers', () => {
  it('the message contains no PHI and passes the wording check', () => {
    expect(SMS_BODY).not.toMatch(/dose of|medicine name|\d{4}-\d{2}-\d{2}/i);
    expect(findBannedPhrases(SMS_BODY)).toEqual([]);
  });
  it('console provider records sends', async () => {
    const p = new ConsoleSmsProvider();
    expect(await p.send('555-0101', SMS_BODY, 'a1')).toEqual({ ok: true });
    expect(p.sent).toHaveLength(1);
  });
  it('twilio provider posts form data with basic auth', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const p = new TwilioSmsProvider({
      accountSid: 'AC123',
      authToken: 'tok',
      from: '+15550100',
      fetchImpl: (async (url: string, init: RequestInit) => {
        calls.push({ url, init });
        return new Response('{}', { status: 201 });
      }) as unknown as typeof fetch,
    });
    expect(await p.send('+15550101', SMS_BODY, 'a1')).toEqual({ ok: true });
    expect(calls[0]!.url).toBe('https://api.twilio.com/2010-04-01/Accounts/AC123/Messages.json');
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe(
      `Basic ${btoa('AC123:tok')}`,
    );
    expect(String(calls[0]!.init.body)).toContain('To=%2B15550101');
  });
  it('twilio is disabled unless fully configured', () => {
    expect(createSmsProvider({ SMS_PROVIDER: 'twilio' }).name).toBe('console');
    expect(createSmsProvider({ SMS_PROVIDER: 'console' }).name).toBe('console');
    expect(
      createSmsProvider({
        SMS_PROVIDER: 'twilio',
        TWILIO_ACCOUNT_SID: 'a',
        TWILIO_AUTH_TOKEN: 'b',
        TWILIO_FROM_NUMBER: 'c',
      }).name,
    ).toBe('twilio');
  });
});
