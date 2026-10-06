import { describe, expect, it } from 'vitest';
import { toCsv } from './csv';

describe('toCsv', () => {
  it('escapes quotes, commas and newlines', () => {
    expect(toCsv([{ a: 'x,y', b: 'he said "hi"', c: 'line\nbreak' }])).toBe(
      'a,b,c\r\n"x,y","he said ""hi""","line\nbreak"\r\n',
    );
  });
  it('neutralizes spreadsheet formulas and serializes objects', () => {
    expect(toCsv([{ a: '=SUM(1)', b: { k: 1 }, c: null }])).toBe(
      'a,b,c\r\n\'=SUM(1),"{""k"":1}",\r\n',
    );
  });
  it('respects an explicit column order', () => {
    expect(toCsv([{ a: 1, b: 2 }], ['b', 'a'])).toBe('b,a\r\n2,1\r\n');
  });
});
