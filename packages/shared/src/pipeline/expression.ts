/**
 * Tiny expression language used by job `if:` conditions and `${{ }}` interpolation.
 *
 *   expr    := or
 *   or      := and ( '||' and )*
 *   and     := unary ( '&&' unary )*
 *   unary   := '!' unary | compare
 *   compare := primary ( ( '==' | '!=' ) primary )?
 *   primary := STRING | NUMBER | 'true' | 'false' | 'null'
 *            | IDENT ( '.' IDENT )*            (reference, e.g. matrix.node)
 *            | IDENT '(' ( expr ( ',' expr )* )? ')'   (function call)
 *            | '(' expr ')'
 */
import type { Scalar } from './types.js';

export type ExprValue = Scalar | null;

export type Expr =
  | { readonly kind: 'literal'; readonly value: ExprValue }
  | { readonly kind: 'ref'; readonly path: readonly string[] }
  | { readonly kind: 'not'; readonly operand: Expr }
  | {
      readonly kind: 'binary';
      readonly op: '&&' | '||' | '==' | '!=';
      readonly left: Expr;
      readonly right: Expr;
    }
  | { readonly kind: 'call'; readonly name: string; readonly args: readonly Expr[] };

type TokenKind = 'string' | 'number' | 'ident' | 'op' | 'eof';
interface Token {
  readonly kind: TokenKind;
  readonly text: string;
  readonly pos: number;
}

export class ExpressionError extends Error {
  constructor(
    message: string,
    readonly position: number,
  ) {
    super(message);
    this.name = 'ExpressionError';
  }
}

const OPERATORS = ['&&', '||', '==', '!=', '!', '(', ')', ',', '.'] as const;
export const EXPRESSION_FUNCTIONS = ['startsWith', 'endsWith', 'contains'] as const;
const MAX_EXPRESSION_LENGTH = 1024;

export function tokenize(source: string): Token[] {
  if (source.length > MAX_EXPRESSION_LENGTH) {
    throw new ExpressionError(`expression longer than ${MAX_EXPRESSION_LENGTH} characters`, 0);
  }
  const tokens: Token[] = [];
  let i = 0;
  while (i < source.length) {
    const ch = source[i] as string;
    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }
    if (ch === "'" || ch === '"') {
      const end = readString(source, i, ch);
      tokens.push({ kind: 'string', text: unescape(source.slice(i + 1, end)), pos: i });
      i = end + 1;
      continue;
    }
    const num = /^-?\d+(\.\d+)?/.exec(source.slice(i));
    if (num && (ch !== '-' || /\d/.test(source[i + 1] ?? ''))) {
      tokens.push({ kind: 'number', text: num[0], pos: i });
      i += num[0].length;
      continue;
    }
    const ident = /^[A-Za-z_][A-Za-z0-9_-]*/.exec(source.slice(i));
    if (ident) {
      tokens.push({ kind: 'ident', text: ident[0], pos: i });
      i += ident[0].length;
      continue;
    }
    const op = OPERATORS.find((candidate) => source.startsWith(candidate, i));
    if (!op) throw new ExpressionError(`unexpected character '${ch}'`, i);
    tokens.push({ kind: 'op', text: op, pos: i });
    i += op.length;
  }
  tokens.push({ kind: 'eof', text: '', pos: source.length });
  return tokens;
}

function readString(source: string, start: number, quote: string): number {
  let i = start + 1;
  while (i < source.length) {
    if (source[i] === '\\') {
      i += 2;
      continue;
    }
    if (source[i] === quote) return i;
    i += 1;
  }
  throw new ExpressionError('unterminated string literal', start);
}

function unescape(raw: string): string {
  return raw.replace(/\\(.)/g, '$1');
}

class Parser {
  private index = 0;
  constructor(private readonly tokens: readonly Token[]) {}

  parse(): Expr {
    const expr = this.parseOr();
    const next = this.peek();
    if (next.kind !== 'eof') throw new ExpressionError(`unexpected token '${next.text}'`, next.pos);
    return expr;
  }

  private peek(): Token {
    return this.tokens[this.index] as Token;
  }

  private take(): Token {
    const token = this.peek();
    this.index += 1;
    return token;
  }

  private isOp(text: string): boolean {
    const token = this.peek();
    return token.kind === 'op' && token.text === text;
  }

  private expectOp(text: string): void {
    const token = this.take();
    if (token.kind !== 'op' || token.text !== text) {
      throw new ExpressionError(`expected '${text}' but found '${token.text || 'end'}'`, token.pos);
    }
  }

  private parseOr(): Expr {
    let left = this.parseAnd();
    while (this.isOp('||')) {
      this.take();
      left = { kind: 'binary', op: '||', left, right: this.parseAnd() };
    }
    return left;
  }

  private parseAnd(): Expr {
    let left = this.parseUnary();
    while (this.isOp('&&')) {
      this.take();
      left = { kind: 'binary', op: '&&', left, right: this.parseUnary() };
    }
    return left;
  }

  private parseUnary(): Expr {
    if (this.isOp('!')) {
      this.take();
      return { kind: 'not', operand: this.parseUnary() };
    }
    return this.parseCompare();
  }

  private parseCompare(): Expr {
    const left = this.parsePrimary();
    if (this.isOp('==') || this.isOp('!=')) {
      const op = this.take().text as '==' | '!=';
      return { kind: 'binary', op, left, right: this.parsePrimary() };
    }
    return left;
  }

  private parsePrimary(): Expr {
    const token = this.take();
    if (token.kind === 'string') return { kind: 'literal', value: token.text };
    if (token.kind === 'number') return { kind: 'literal', value: Number(token.text) };
    if (token.kind === 'op' && token.text === '(') {
      const inner = this.parseOr();
      this.expectOp(')');
      return inner;
    }
    if (token.kind === 'ident') return this.parseIdentifier(token);
    throw new ExpressionError(`unexpected token '${token.text || 'end'}'`, token.pos);
  }

  private parseIdentifier(token: Token): Expr {
    if (token.text === 'true') return { kind: 'literal', value: true };
    if (token.text === 'false') return { kind: 'literal', value: false };
    if (token.text === 'null') return { kind: 'literal', value: null };
    if (this.isOp('(')) return this.parseCall(token);
    const path = [token.text];
    while (this.isOp('.')) {
      this.take();
      const part = this.take();
      if (part.kind !== 'ident')
        throw new ExpressionError('expected property name after .', part.pos);
      path.push(part.text);
    }
    return { kind: 'ref', path };
  }

  private parseCall(token: Token): Expr {
    if (!(EXPRESSION_FUNCTIONS as readonly string[]).includes(token.text)) {
      throw new ExpressionError(`unknown function '${token.text}'`, token.pos);
    }
    this.expectOp('(');
    const args: Expr[] = [];
    if (!this.isOp(')')) {
      args.push(this.parseOr());
      while (this.isOp(',')) {
        this.take();
        args.push(this.parseOr());
      }
    }
    this.expectOp(')');
    if (args.length !== 2) {
      throw new ExpressionError(`${token.text}() takes exactly 2 arguments`, token.pos);
    }
    return { kind: 'call', name: token.text, args };
  }
}

export function parseExpression(source: string): Expr {
  if (source.trim() === '') throw new ExpressionError('expression is empty', 0);
  return new Parser(tokenize(source)).parse();
}

/** Lookup function resolving a dotted reference; returns undefined for unknown names. */
export type Resolver = (path: readonly string[]) => ExprValue | undefined;

export function truthy(value: ExprValue): boolean {
  return value !== null && value !== false && value !== 0 && value !== '';
}

export function stringify(value: ExprValue): string {
  return value === null ? '' : String(value);
}

function looseEquals(a: ExprValue, b: ExprValue): boolean {
  if (a === null || b === null) return a === b;
  if (typeof a === typeof b) return a === b;
  return String(a) === String(b);
}

export function evaluate(expr: Expr, resolve: Resolver): ExprValue {
  switch (expr.kind) {
    case 'literal':
      return expr.value;
    case 'ref': {
      const value = resolve(expr.path);
      if (value === undefined)
        throw new ExpressionError(`unknown reference '${expr.path.join('.')}'`, 0);
      return value;
    }
    case 'not':
      return !truthy(evaluate(expr.operand, resolve));
    case 'binary':
      return evaluateBinary(expr.op, expr.left, expr.right, resolve);
    case 'call':
      return evaluateCall(expr.name, expr.args, resolve);
  }
}

function evaluateBinary(op: string, left: Expr, right: Expr, resolve: Resolver): ExprValue {
  if (op === '&&') return truthy(evaluate(left, resolve)) && truthy(evaluate(right, resolve));
  if (op === '||') return truthy(evaluate(left, resolve)) || truthy(evaluate(right, resolve));
  const equal = looseEquals(evaluate(left, resolve), evaluate(right, resolve));
  return op === '==' ? equal : !equal;
}

function evaluateCall(name: string, args: readonly Expr[], resolve: Resolver): ExprValue {
  const [a, b] = args.map((arg) => stringify(evaluate(arg, resolve)));
  if (name === 'startsWith') return (a as string).startsWith(b as string);
  if (name === 'endsWith') return (a as string).endsWith(b as string);
  return (a as string).includes(b as string);
}

/** Collects every dotted reference used by an expression (for static validation). */
export function collectReferences(expr: Expr): string[][] {
  switch (expr.kind) {
    case 'literal':
      return [];
    case 'ref':
      return [[...expr.path]];
    case 'not':
      return collectReferences(expr.operand);
    case 'binary':
      return [...collectReferences(expr.left), ...collectReferences(expr.right)];
    case 'call':
      return expr.args.flatMap(collectReferences);
  }
}
