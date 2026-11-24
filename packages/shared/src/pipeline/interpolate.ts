import {
  evaluate,
  ExpressionError,
  parseExpression,
  stringify,
  type Expr,
  type Resolver,
} from './expression.js';

const PLACEHOLDER = /\$\{\{([\s\S]*?)\}\}/g;

export interface Placeholder {
  readonly source: string;
  readonly expr: Expr;
}

/** Parses every `${{ expr }}` placeholder in a template; throws ExpressionError on bad syntax. */
export function parseTemplate(template: string): Placeholder[] {
  const found: Placeholder[] = [];
  for (const match of template.matchAll(PLACEHOLDER)) {
    const source = (match[1] as string).trim();
    found.push({ source, expr: parseExpression(source) });
  }
  if (found.length === 0 && template.includes('${{')) {
    throw new ExpressionError("unterminated '${{' placeholder", template.indexOf('${{'));
  }
  return found;
}

/** Replaces every placeholder with its evaluated, stringified value. */
export function interpolate(template: string, resolve: Resolver): string {
  if (!template.includes('${{')) return template;
  return template.replace(PLACEHOLDER, (_whole, inner: string) =>
    stringify(evaluate(parseExpression(inner.trim()), resolve)),
  );
}
