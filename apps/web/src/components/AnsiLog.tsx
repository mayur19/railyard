import { DEFAULT_STYLE, parseAnsi, type AnsiSegment, type AnsiStyle } from '@railyard/shared';
import type { CSSProperties } from 'react';

export interface LogLine {
  readonly stream: 'stdout' | 'stderr' | 'system';
  readonly text: string;
}

const PALETTE: Record<string, string> = {
  black: '#3b4252',
  red: '#e06c75',
  green: '#98c379',
  yellow: '#e5c07b',
  blue: '#61afef',
  magenta: '#c678dd',
  cyan: '#56b6c2',
  white: '#dcdfe4',
};

export function colorFor(name: string | null): string | undefined {
  if (!name) return undefined;
  if (name.startsWith('rgb(')) return name;
  const base = name.replace('bright-', '');
  return PALETTE[base];
}

function styleOf(style: AnsiStyle): CSSProperties {
  return {
    color: colorFor(style.fg),
    backgroundColor: colorFor(style.bg),
    fontWeight: style.bold ? 700 : undefined,
    opacity: style.dim ? 0.7 : undefined,
    fontStyle: style.italic ? 'italic' : undefined,
    textDecoration: style.underline ? 'underline' : undefined,
  };
}

/** Splits raw chunks into lines and renders ANSI colours, carrying style across lines. */
export function toRenderedLines(
  lines: readonly LogLine[],
): { stream: LogLine['stream']; segments: AnsiSegment[] }[] {
  let style = DEFAULT_STYLE;
  return lines.map((line) => {
    const parsed = parseAnsi(line.text, style);
    style = parsed.style;
    return { stream: line.stream, segments: parsed.segments };
  });
}

export function splitChunks(
  chunks: readonly { stream: LogLine['stream']; content: string }[],
): LogLine[] {
  return chunks.flatMap((chunk) => {
    const parts = chunk.content.split('\n');
    if (parts[parts.length - 1] === '') parts.pop();
    return parts.map((text) => ({ stream: chunk.stream, text }));
  });
}

export function AnsiLog({ lines }: { lines: readonly LogLine[] }) {
  const rendered = toRenderedLines(lines);
  if (rendered.length === 0) return <pre className="log log-empty">Waiting for output…</pre>;
  return (
    <pre className="log" aria-label="Job log">
      {rendered.map((line, index) => (
        <div key={index} className={`log-line log-${line.stream}`}>
          <span className="log-number" aria-hidden="true">
            {index + 1}
          </span>
          {line.segments.map((segment, i) => (
            <span key={i} style={styleOf(segment.style)}>
              {segment.text}
            </span>
          ))}
        </div>
      ))}
    </pre>
  );
}
