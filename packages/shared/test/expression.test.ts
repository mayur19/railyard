import { describe, expect, it } from 'vitest';
import {
  collectReferences,
  evaluate,
  ExpressionError,
  parseExpression,
  stringify,
  tokenize,
  truthy,
  type Resolver,
} from '../src/pipeline/expression.js';

const ctx: Record<string, string | number | boolean | null> = {
  branch: 'main',
  event: 'push',
  'matrix.node': 20,
  'matrix.os': 'linux',
  'env.DEPLOY': 'true',
  'env.EMPTY': '',
};
const resolve: Resolver = (path) => ctx[path.join('.')];
const run = (src: string) => evaluate(parseExpression(src), resolve);

describe('expression tokenizer', () => {
  it('tokenizes strings, numbers, identifiers and operators', () => {
    const kinds = tokenize("a.b == 'x' && !(n != -2.5)").map((t) => t.kind);
    expect(kinds).toEqual([
      'ident',
      'op',
      'ident',
      'op',
      'string',
      'op',
      'op',
      'op',
      'ident',
      'op',
      'number',
      'op',
      'eof',
    ]);
  });

  it('handles escaped quotes in strings', () => {
    expect(tokenize("'it\\'s'")[0]?.text).toBe("it's");
  });

  it('rejects unterminated strings and unknown characters', () => {
    expect(() => tokenize("'abc")).toThrow(ExpressionError);
    expect(() => tokenize('a $ b')).toThrow(/unexpected character/);
  });

  it('rejects overly long expressions', () => {
    expect(() => tokenize('a'.repeat(2000))).toThrow(/longer than/);
  });
});

describe('expression evaluation', () => {
  it.each([
    ["branch == 'main'", true],
    ["branch != 'main'", false],
    ["branch == 'main' && event == 'push'", true],
    ["branch == 'dev' || event == 'push'", true],
    ["!(branch == 'main')", false],
    ['matrix.node == 20', true],
    ["matrix.node == '20'", true],
    ["matrix.os == 'linux' && matrix.node != 22", true],
    ["startsWith(branch, 'ma')", true],
    ["endsWith(branch, 'in')", true],
    ["contains('release/1.2', 'release')", true],
    ['env.DEPLOY == true', true],
    ['null == null', true],
    ["null == ''", false],
    ['true && false || true', true],
    ['true || false && false', true],
  ])('%s -> %s', (src, expected) => {
    expect(truthy(run(src))).toBe(expected);
  });

  it('respects precedence: && binds tighter than ||', () => {
    const ast = parseExpression('a || b && c');
    expect(ast.kind === 'binary' && ast.op).toBe('||');
  });

  it('throws on unknown references at evaluation time', () => {
    expect(() => run('nope == 1')).toThrow(/unknown reference 'nope'/);
  });

  it('reports syntax errors', () => {
    expect(() => parseExpression('')).toThrow(/empty/);
    expect(() => parseExpression('a ==')).toThrow(ExpressionError);
    expect(() => parseExpression('(a == b')).toThrow(/expected '\)'/);
    expect(() => parseExpression('a b')).toThrow(/unexpected token/);
    expect(() => parseExpression('a.')).toThrow(/property name/);
    expect(() => parseExpression('explode(a, b)')).toThrow(/unknown function/);
    expect(() => parseExpression('startsWith(a)')).toThrow(/exactly 2 arguments/);
    expect(() => parseExpression(')')).toThrow(/unexpected token/);
  });

  it('parses zero-argument call and reports arity', () => {
    expect(() => parseExpression('contains()')).toThrow(/exactly 2/);
  });

  it('truthiness and stringification', () => {
    expect([null, false, 0, ''].map(truthy)).toEqual([false, false, false, false]);
    expect(['x', 1, true].map(truthy)).toEqual([true, true, true]);
    expect(stringify(null)).toBe('');
    expect(stringify(3)).toBe('3');
    expect(truthy(run('env.EMPTY'))).toBe(false);
  });

  it('collects references for static checks', () => {
    const refs = collectReferences(
      parseExpression("matrix.os == 'x' && !startsWith(branch, env.P) || true"),
    );
    expect(refs).toEqual([['matrix', 'os'], ['branch'], ['env', 'P']]);
  });
});
