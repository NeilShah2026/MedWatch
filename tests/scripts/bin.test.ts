import { describe, expect, it } from 'vitest';
import { BINS, redactArgs, runBin } from '../../scripts/lib/bin.mjs';

describe('CLI launcher (no shell, no npx)', () => {
  it('starts the Supabase CLI through Node', () => {
    const r = runBin('supabase', ['--version'], { stdio: 'pipe' });
    expect(r.error).toBeNull();
    expect(r.status).toBe(0);
  });
  it('starts Deno through Node', () => {
    const r = runBin('deno', ['--version'], { stdio: 'pipe' });
    expect(r.error).toBeNull();
    expect(r.status).toBe(0);
  });
  it('passes arguments with shell metacharacters through untouched', () => {
    // A cmd.exe or sh shell would split or expand these; a direct spawn must not.
    const r = runBin(
      'deno',
      ['eval', 'Deno.exit(Deno.args[0] === "p&ss %X% ^q" ? 0 : 3)', 'p&ss %X% ^q'],
      { stdio: 'pipe' },
    );
    expect(r.status).toBe(0);
  });
  it('reports a clear error when the CLI is not installed', () => {
    const saved = BINS.deno;
    BINS.deno = 'node_modules/does-not-exist/bin.cjs';
    try {
      const r = runBin('deno', ['--version']);
      expect(r.status).toBe(1);
      expect(r.error?.message).toMatch(/Run `npm install`/);
    } finally {
      BINS.deno = saved;
    }
  });
  it('redacts secret flag values before echoing commands', () => {
    expect(redactArgs(['link', '--project-ref', 'abc', '--password', 'hunter2'])).toEqual([
      'link',
      '--project-ref',
      'abc',
      '--password',
      '****',
    ]);
  });
});
