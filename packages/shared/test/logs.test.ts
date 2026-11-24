import { describe, expect, it } from 'vitest';
import { applySgr, DEFAULT_STYLE, parseAnsi, stripAnsi } from '../src/logs/ansi.js';
import { createMasker, MASK, maskSecrets } from '../src/logs/mask.js';

const ESC = '\u001b';

describe('parseAnsi', () => {
  it('returns plain text as a single default segment', () => {
    expect(parseAnsi('hello').segments).toEqual([{ text: 'hello', style: DEFAULT_STYLE }]);
  });

  it('applies colours and resets', () => {
    const { segments } = parseAnsi(`${ESC}[1;31merror${ESC}[0m done`);
    expect(segments[0]).toMatchObject({ text: 'error', style: { fg: 'red', bold: true } });
    expect(segments[1]).toMatchObject({ text: ' done', style: DEFAULT_STYLE });
  });

  it('carries style across calls', () => {
    const first = parseAnsi(`${ESC}[32mgreen`);
    const second = parseAnsi('still green', first.style);
    expect(second.segments[0]?.style.fg).toBe('green');
  });

  it('supports bright, background, 256 and truecolor', () => {
    expect(applySgr(DEFAULT_STYLE, [92]).fg).toBe('bright-green');
    expect(applySgr(DEFAULT_STYLE, [44]).bg).toBe('blue');
    expect(applySgr(DEFAULT_STYLE, [101]).bg).toBe('bright-red');
    expect(applySgr(DEFAULT_STYLE, [38, 5, 1]).fg).toBe('red');
    expect(applySgr(DEFAULT_STYLE, [38, 5, 9]).fg).toBe('bright-red');
    expect(applySgr(DEFAULT_STYLE, [38, 5, 196]).fg).toBe('rgb(255,0,0)');
    expect(applySgr(DEFAULT_STYLE, [38, 5, 232]).fg).toBe('rgb(8,8,8)');
    expect(applySgr(DEFAULT_STYLE, [38, 5, 999]).fg).toBeNull();
    expect(applySgr(DEFAULT_STYLE, [48, 2, 10, 20, 30]).bg).toBe('rgb(10,20,30)');
    expect(applySgr(DEFAULT_STYLE, [48, 2, 10, 20]).bg).toBeNull();
    expect(applySgr(DEFAULT_STYLE, [38, 9]).fg).toBeNull();
  });

  it('toggles attributes', () => {
    const on = applySgr(DEFAULT_STYLE, [1, 2, 3, 4, 31, 41]);
    expect(on).toMatchObject({ bold: true, dim: true, italic: true, underline: true });
    const off = applySgr(on, [22, 23, 24, 39, 49]);
    expect(off).toEqual(DEFAULT_STYLE);
    expect(applySgr(on, [])).toEqual(DEFAULT_STYLE);
  });

  it('drops non-SGR sequences and carriage returns', () => {
    const { segments } = parseAnsi(`a${ESC}[2Kb${ESC}[?25lc\r${ESC}]0;title\u0007d`);
    expect(segments.map((s) => s.text).join('')).toBe('abcd');
  });

  it('treats empty params as reset', () => {
    const { segments } = parseAnsi(`${ESC}[31mx${ESC}[my`);
    expect(segments[1]?.style).toEqual(DEFAULT_STYLE);
    expect(parseAnsi(`${ESC}[;1mz`).segments[0]?.style.bold).toBe(true);
  });

  it('strips escapes', () => {
    expect(stripAnsi(`${ESC}[1;32mok${ESC}[0m`)).toBe('ok');
  });
});

describe('secret masking', () => {
  it('masks complete strings', () => {
    expect(maskSecrets('token=abcd1234 and abcd1234', ['abcd1234'])).toBe(
      `token=${MASK} and ${MASK}`,
    );
  });

  it('ignores very short secrets', () => {
    expect(maskSecrets('abc', ['abc'])).toBe('abc');
  });

  it('masks secrets split across chunks', () => {
    const masker = createMasker(['supersecret']);
    const out = masker.push('value: super') + masker.push('secret!\n') + masker.flush();
    expect(out).toBe(`value: ${MASK}!\n`);
  });

  it('releases held-back text that cannot be a secret', () => {
    const masker = createMasker(['secretvalue']);
    expect(masker.push('hello sec')).toBe('hello ');
    expect(masker.push('ond line')).toBe('second line');
    expect(masker.flush()).toBe('');
  });

  it('prefers the longest overlapping secret', () => {
    expect(maskSecrets('pass1234-extended', ['pass1234', 'pass1234-extended'])).toBe(MASK);
  });

  it('is a passthrough without secrets', () => {
    const masker = createMasker([]);
    expect(masker.push('abc')).toBe('abc');
    expect(masker.flush()).toBe('');
  });

  it('masks every chunking of a stream identically (property)', () => {
    const secret = 'Zx9-Secret-Q';
    const text = `start ${secret} middle ${secret}${secret} end ${secret.slice(0, 5)}`;
    for (let size = 1; size <= text.length; size += 1) {
      const masker = createMasker([secret]);
      let out = '';
      for (let i = 0; i < text.length; i += size) out += masker.push(text.slice(i, i + size));
      out += masker.flush();
      expect(out).toBe(maskSecrets(text, [secret]));
      expect(out).not.toContain(secret);
    }
  });
});
