import {
  isCollection,
  isScalar as isYamlScalar,
  LineCounter,
  parseDocument,
  type Document,
} from 'yaml';
import type { PathPart } from './issues.js';
import type { PipelineIssue } from './types.js';
import { PIPELINE_LIMITS } from './limits.js';

export interface LoadedYaml {
  readonly value: unknown;
  readonly issues: readonly PipelineIssue[];
  readonly locate: (path: readonly PathPart[]) => { line: number; column: number } | null;
}

const NO_LOCATION = (): null => null;

/** Parses YAML text into plain JS values, reporting syntax errors with line/column. */
export function loadYaml(source: string): LoadedYaml {
  if (new TextEncoder().encode(source).length > PIPELINE_LIMITS.maxYamlBytes) {
    return failure('yaml_too_large', `pipeline file exceeds ${PIPELINE_LIMITS.maxYamlBytes} bytes`);
  }
  const lineCounter = new LineCounter();
  const doc = parseDocument(source, { lineCounter, uniqueKeys: true });
  if (doc.errors.length > 0) {
    const issues = doc.errors.map((err) => {
      const pos = lineCounter.linePos(err.pos[0]);
      return {
        severity: 'error' as const,
        code: 'yaml_syntax',
        path: '$',
        message: err.message.split('\n')[0] ?? err.message,
        line: pos.line,
        column: pos.col,
      };
    });
    return { value: null, issues, locate: NO_LOCATION };
  }
  return { value: doc.toJS({ maxAliasCount: 50 }), issues: [], locate: locator(doc, lineCounter) };
}

function failure(code: string, message: string): LoadedYaml {
  return {
    value: null,
    issues: [{ severity: 'error', code, path: '$', message }],
    locate: NO_LOCATION,
  };
}

function locator(doc: Document, lineCounter: LineCounter) {
  return (path: readonly PathPart[]): { line: number; column: number } | null => {
    // Walk up the path until a node with a source range is found.
    for (let depth = path.length; depth >= 0; depth -= 1) {
      const node = depth === 0 ? doc.contents : doc.getIn(path.slice(0, depth), true);
      if ((isCollection(node) || isYamlScalar(node)) && node.range) {
        const pos = lineCounter.linePos(node.range[0]);
        return { line: pos.line, column: pos.col };
      }
    }
    return null;
  };
}
