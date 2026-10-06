/**
 * Hard Rule 2 / spec §11 "Wording test": fails if any banned phrase appears in a
 * user-facing string in apps/web/src, packages/core/src or rules/.
 * Strings are extracted with the TypeScript parser (string literals, template text, JSX text),
 * so comments and identifiers are not scanned.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import ts from 'typescript';
import { findBannedPhrases } from '../../packages/core/src/wording.ts';

const ROOT = resolve(__dirname, '../..');
// The guard itself must list the phrases it bans.
const EXEMPT = new Set(['packages/core/src/wording.ts']);

function walk(dir: string, exts: string[]): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p, exts));
    else if (exts.some((e) => name.endsWith(e)) && !name.endsWith('.test.ts')) out.push(p);
  }
  return out;
}

export function extractStrings(file: string, text: string): string[] {
  const sf = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const strings: string[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) return;
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) strings.push(n.text);
    else if (ts.isTemplateExpression(n)) {
      strings.push(n.head.text, ...n.templateSpans.map((s) => s.literal.text));
    } else if (ts.isJsxText(n)) strings.push(n.text);
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return strings;
}

function jsonStrings(v: unknown): string[] {
  if (typeof v === 'string') return [v];
  if (Array.isArray(v)) return v.flatMap(jsonStrings);
  if (v && typeof v === 'object') return Object.values(v).flatMap(jsonStrings);
  return [];
}

describe('banned clinical wording', () => {
  const sources = [
    ...walk(join(ROOT, 'apps/web/src'), ['.ts', '.tsx']),
    ...walk(join(ROOT, 'packages/core/src'), ['.ts']),
  ].filter((f) => !EXEMPT.has(relative(ROOT, f)));

  it('scans a meaningful number of files', () => {
    expect(sources.length).toBeGreaterThan(10);
  });

  it('no banned phrase appears in any string in apps/web/src or packages/core/src', () => {
    const hits: string[] = [];
    for (const f of sources) {
      for (const s of extractStrings(f, readFileSync(f, 'utf8'))) {
        const found = findBannedPhrases(s);
        if (found.length)
          hits.push(`${relative(ROOT, f)}: "${s.slice(0, 80)}" → ${found.join(', ')}`);
      }
    }
    expect(hits).toEqual([]);
  });

  it('no banned phrase appears in any rule file', () => {
    const hits: string[] = [];
    for (const f of walk(join(ROOT, 'rules'), ['.json']).filter((f) => !f.includes('/schemas/'))) {
      for (const s of jsonStrings(JSON.parse(readFileSync(f, 'utf8')))) {
        const found = findBannedPhrases(s);
        if (found.length)
          hits.push(`${relative(ROOT, f)}: "${s.slice(0, 80)}" → ${found.join(', ')}`);
      }
    }
    expect(hits).toEqual([]);
  });

  it('the extractor really sees strings, template text and JSX text', () => {
    const strings = extractStrings(
      'x.tsx',
      'const a = "one"; const b = `two ${a} three`; const c = <p>four</p>; // stop taking',
    );
    expect(strings).toEqual(expect.arrayContaining(['one', 'two ', ' three', 'four']));
    expect(strings.join(' ')).not.toContain('stop taking');
  });
});
