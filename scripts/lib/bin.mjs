import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT } from './env.mjs';

/** JS entry points of the CLIs installed as dev dependencies. */
export const BINS = {
  supabase: 'node_modules/supabase/dist/supabase.js',
  deno: 'node_modules/deno/bin.cjs',
};

/** Hide secret flag values (e.g. `--password x`) before echoing a command. */
export function redactArgs(args) {
  const secret = new Set(['--password', '-p', '--token']);
  return args.map((a, i) => (i > 0 && secret.has(args[i - 1]) ? '****' : a));
}

/**
 * Run a CLI's JS entry point with the current Node binary. No shell and no `npx`, so it
 * works the same on Windows, macOS and Linux and arguments (passwords with `&`, `%`, `^`)
 * are passed through untouched.
 */
export function runBin(name, args, { env = process.env, stdio = 'inherit', input } = {}) {
  const entry = resolve(ROOT, BINS[name]);
  if (!existsSync(entry)) {
    return {
      status: 1,
      error: new Error(`${name} CLI not found at ${entry}. Run \`npm install\` first.`),
    };
  }
  const r = spawnSync(process.execPath, [entry, ...args], { cwd: ROOT, stdio, input, env });
  return { status: r.status ?? 1, error: r.error ?? null };
}
