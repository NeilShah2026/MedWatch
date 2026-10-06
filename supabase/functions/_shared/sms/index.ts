/**
 * SMS provider interface (spec §8 `send-alert`). Messages never contain PHI: they only say an
 * alert is waiting in the app. ConsoleSmsProvider is the default for development.
 */
import { fnLog } from '../logger.ts';

export interface SmsProvider {
  readonly name: 'console' | 'twilio';
  send(to: string, body: string, alertId: string): Promise<{ ok: boolean }>;
}

export const SMS_BODY = 'MedWatch: a new alert is waiting in the app. Sign in to view it.';

export class ConsoleSmsProvider implements SmsProvider {
  readonly name = 'console' as const;
  readonly sent: { to: string; body: string; alertId: string }[] = [];
  async send(to: string, body: string, alertId: string) {
    this.sent.push({ to, body, alertId });
    // Last 4 digits only; the body is fixed and PHI-free.
    fnLog.info('sms.console', { alert_id: alertId, code: to.replace(/\D/g, '').slice(-4) });
    return { ok: true };
  }
}

export interface TwilioConfig {
  accountSid: string;
  authToken: string;
  from: string;
  fetchImpl?: typeof fetch;
}

export class TwilioSmsProvider implements SmsProvider {
  readonly name = 'twilio' as const;
  constructor(private readonly cfg: TwilioConfig) {}
  async send(to: string, body: string, alertId: string) {
    const f = this.cfg.fetchImpl ?? fetch;
    const res = await f(
      `https://api.twilio.com/2010-04-01/Accounts/${this.cfg.accountSid}/Messages.json`,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${btoa(`${this.cfg.accountSid}:${this.cfg.authToken}`)}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ To: to, From: this.cfg.from, Body: body }).toString(),
      },
    ).catch(() => null);
    const ok = Boolean(res && res.ok);
    fnLog.info('sms.twilio', { alert_id: alertId, status: res?.status ?? null });
    return { ok };
  }
}

export interface SmsEnv {
  SMS_PROVIDER: 'console' | 'twilio';
  TWILIO_ACCOUNT_SID?: string;
  TWILIO_AUTH_TOKEN?: string;
  TWILIO_FROM_NUMBER?: string;
}

/** Twilio only when explicitly selected AND fully configured; otherwise the console provider. */
export function createSmsProvider(env: SmsEnv): SmsProvider {
  if (
    env.SMS_PROVIDER === 'twilio' &&
    env.TWILIO_ACCOUNT_SID &&
    env.TWILIO_AUTH_TOKEN &&
    env.TWILIO_FROM_NUMBER
  ) {
    return new TwilioSmsProvider({
      accountSid: env.TWILIO_ACCOUNT_SID,
      authToken: env.TWILIO_AUTH_TOKEN,
      from: env.TWILIO_FROM_NUMBER,
    });
  }
  return new ConsoleSmsProvider();
}
