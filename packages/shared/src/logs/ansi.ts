/**
 * Minimal ANSI SGR parser for rendering build logs. Converts text with escape sequences into
 * styled segments. Non-SGR CSI sequences (cursor movement, erase) and OSC sequences are dropped.
 */
export interface AnsiStyle {
  readonly fg: string | null;
  readonly bg: string | null;
  readonly bold: boolean;
  readonly dim: boolean;
  readonly italic: boolean;
  readonly underline: boolean;
}

export interface AnsiSegment {
  readonly text: string;
  readonly style: AnsiStyle;
}

export const DEFAULT_STYLE: AnsiStyle = Object.freeze({
  fg: null,
  bg: null,
  bold: false,
  dim: false,
  italic: false,
  underline: false,
});

const BASE_COLORS = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white'];
const SEQUENCE =
  // eslint-disable-next-line no-control-regex
  /\u001b\[([0-9;?]*)([A-Za-z])|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)|\u001b[()][A-Za-z0-9]/g;

function color256(n: number): string | null {
  if (!Number.isInteger(n) || n < 0 || n > 255) return null;
  if (n < 8) return BASE_COLORS[n] as string;
  if (n < 16) return `bright-${BASE_COLORS[n - 8]}`;
  if (n < 232) {
    const index = n - 16;
    const levels = [0, 95, 135, 175, 215, 255];
    const r = levels[Math.floor(index / 36)] as number;
    const g = levels[Math.floor(index / 6) % 6] as number;
    const b = levels[index % 6] as number;
    return `rgb(${r},${g},${b})`;
  }
  const grey = 8 + (n - 232) * 10;
  return `rgb(${grey},${grey},${grey})`;
}

/** Applies one SGR parameter list to a style, returning a new style. */
export function applySgr(style: AnsiStyle, params: readonly number[]): AnsiStyle {
  let next = { ...style };
  const codes = params.length === 0 ? [0] : params;
  for (let i = 0; i < codes.length; i += 1) {
    const code = codes[i] as number;
    if (code === 0) next = { ...DEFAULT_STYLE };
    else if (code === 1) next.bold = true;
    else if (code === 2) next.dim = true;
    else if (code === 3) next.italic = true;
    else if (code === 4) next.underline = true;
    else if (code === 22) next = { ...next, bold: false, dim: false };
    else if (code === 23) next.italic = false;
    else if (code === 24) next.underline = false;
    else if (code >= 30 && code <= 37) next.fg = BASE_COLORS[code - 30] as string;
    else if (code >= 90 && code <= 97) next.fg = `bright-${BASE_COLORS[code - 90]}`;
    else if (code >= 40 && code <= 47) next.bg = BASE_COLORS[code - 40] as string;
    else if (code >= 100 && code <= 107) next.bg = `bright-${BASE_COLORS[code - 100]}`;
    else if (code === 39) next.fg = null;
    else if (code === 49) next.bg = null;
    else if (code === 38 || code === 48) {
      const [value, consumed] = extendedColor(codes, i + 1);
      if (code === 38) next.fg = value;
      else next.bg = value;
      i += consumed;
    }
  }
  return next;
}

function extendedColor(codes: readonly number[], at: number): [string | null, number] {
  const mode = codes[at];
  if (mode === 5) return [color256(codes[at + 1] ?? -1), 2];
  if (mode === 2) {
    const [r, g, b] = [codes[at + 1], codes[at + 2], codes[at + 3]];
    const valid = [r, g, b].every((c) => c !== undefined && c >= 0 && c <= 255);
    return [valid ? `rgb(${r},${g},${b})` : null, 4];
  }
  return [null, 0];
}

/**
 * Parses a line (or chunk) into segments, starting from `initial` style so state can carry
 * across lines. Returns the segments and the style in effect at the end.
 */
export function parseAnsi(
  input: string,
  initial: AnsiStyle = DEFAULT_STYLE,
): { segments: AnsiSegment[]; style: AnsiStyle } {
  const segments: AnsiSegment[] = [];
  let style = initial;
  let last = 0;
  const push = (text: string): void => {
    const clean = text.replace(/\r/g, '');
    if (clean === '') return;
    const prev = segments[segments.length - 1];
    if (prev && prev.style === style)
      segments[segments.length - 1] = { text: prev.text + clean, style };
    else segments.push({ text: clean, style });
  };
  for (const match of input.matchAll(SEQUENCE)) {
    push(input.slice(last, match.index));
    last = (match.index as number) + match[0].length;
    if (match[2] === 'm' && match[1] !== undefined && !match[1].includes('?')) {
      const params =
        match[1] === '' ? [] : match[1].split(';').map((p) => (p === '' ? 0 : Number(p)));
      style = applySgr(style, params);
    }
  }
  push(input.slice(last));
  return { segments, style };
}

/** Removes every escape sequence, leaving plain text. */
export function stripAnsi(input: string): string {
  return input.replace(SEQUENCE, '');
}
