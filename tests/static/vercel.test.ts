import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const cfg = JSON.parse(readFileSync(resolve(__dirname, '../../vercel.json'), 'utf8')) as {
  buildCommand: string;
  outputDirectory: string;
  rewrites: { source: string; destination: string }[];
  headers: { source: string; headers: { key: string; value: string }[] }[];
  functions?: unknown;
};
const header = (k: string) => cfg.headers[0]!.headers.find((h) => h.key === k)?.value ?? '';

describe('vercel.json (spec §14)', () => {
  it('builds the web app and serves apps/web/dist as an SPA', () => {
    expect(cfg.buildCommand).toBe('npm run build -w apps/web');
    expect(cfg.outputDirectory).toBe('apps/web/dist');
    expect(cfg.rewrites).toEqual([{ source: '/(.*)', destination: '/index.html' }]);
  });
  it('sets the required security headers', () => {
    expect(header('Content-Security-Policy')).toMatch(/default-src 'self'/);
    expect(header('Content-Security-Policy')).toMatch(
      /connect-src 'self' https:\/\/\*\.supabase\.co/,
    );
    expect(header('Content-Security-Policy')).toMatch(/frame-ancestors 'none'/);
    expect(header('Strict-Transport-Security')).toMatch(/max-age=\d+/);
    expect(header('X-Content-Type-Options')).toBe('nosniff');
    expect(header('Referrer-Policy')).toBe('no-referrer');
    expect(header('Permissions-Policy')).toBe('camera=(), microphone=(), geolocation=()');
  });
  it('defines no serverless functions (patient data never passes through Vercel)', () => {
    expect(cfg.functions).toBeUndefined();
  });
});
