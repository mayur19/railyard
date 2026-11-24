import { describe, expect, it } from 'vitest';
import { compilePlan, PlanError } from '../src/pipeline/plan.js';
import type { PipelineSpec, RunContext } from '../src/pipeline/types.js';
import { validatePipelineYaml } from '../src/pipeline/validate.js';
import { FULL_PIPELINE } from './fixtures.js';

const main: RunContext = { branch: 'main', sha: 'abc1234', event: 'push', runNumber: 3 };
const feature: RunContext = { ...main, branch: 'feature/x' };

function spec(yaml: string): PipelineSpec {
  const result = validatePipelineYaml(yaml);
  if (!result.spec) throw new Error(JSON.stringify(result.issues));
  return result.spec;
}

describe('compilePlan with the full pipeline', () => {
  const plan = compilePlan(spec(FULL_PIPELINE), main);
  const byKey = new Map(plan.jobs.map((j) => [j.key, j]));

  it('expands the matrix with excludes and includes', () => {
    const unitKeys = plan.jobs.filter((j) => j.jobId === 'unit').map((j) => j.key);
    expect(unitKeys).toEqual([
      'unit[node=20,shard=1]',
      'unit[node=22,shard=1]',
      'unit[node=22,shard=2]',
      'unit[node=23,shard=1,experimental=true]',
    ]);
  });

  it('resolves explicit and implicit stage needs', () => {
    expect(byKey.get('lint')?.needs).toEqual([]);
    expect(byKey.get('unit[node=20,shard=1]')?.needs).toEqual(['compile']);
    // e2e has no needs: it implicitly depends on every job of the previous stage
    expect(byKey.get('e2e')?.needs).toEqual(['lint', 'compile']);
    // deploy depends on all test-stage instances
    expect(byKey.get('deploy')?.needs).toHaveLength(5);
    expect(byKey.get('notify')?.needs).toHaveLength(4);
  });

  it('assigns topological levels', () => {
    expect(plan.levels[0]).toEqual(['lint', 'compile']);
    expect(plan.levels[1]).toContain('e2e');
    expect(plan.levels[2]).toEqual(['deploy', 'notify']);
    expect(byKey.get('deploy')?.level).toBe(2);
  });

  it('computes a critical path across all levels', () => {
    expect(plan.criticalPath).toHaveLength(3);
    expect(plan.levels[0]).toContain(plan.criticalPath[0]);
    expect(plan.levels[2]).toContain(plan.criticalPath[2]);
  });

  it('interpolates step scripts, env and names', () => {
    const compile = byKey.get('compile');
    expect(compile?.env.TARGET).toBe('web-bundle');
    expect(compile?.steps[0]?.run).toBe('echo "compiling web-bundle on main"');
    const unit = byKey.get('unit[node=22,shard=2]');
    expect(unit?.steps[0]?.run).toBe('echo "node 22 shard 2"');
    expect(unit?.name).toBe('unit (22, 2)');
    expect(unit?.env.MATRIX_NODE).toBe('22');
    expect(unit?.env.RAILYARD_BRANCH).toBe('main');
    expect(unit?.retries).toBe(1);
  });

  it('applies step and job timeouts', () => {
    expect(byKey.get('deploy')?.timeoutSeconds).toBe(900);
    expect(byKey.get('deploy')?.steps[0]?.timeoutSeconds).toBe(300);
    expect(byKey.get('lint')?.steps[0]?.timeoutSeconds).toBe(3600);
  });

  it('carries when and allow-failure', () => {
    expect(byKey.get('notify')?.when).toBe('on_failure');
    expect(byKey.get('e2e')?.allowFailure).toBe(true);
  });

  it('is deterministic', () => {
    expect(compilePlan(spec(FULL_PIPELINE), main)).toEqual(plan);
  });
});

describe('compilePlan conditions', () => {
  it('excludes jobs whose condition is false', () => {
    const plan = compilePlan(spec(FULL_PIPELINE), feature);
    expect(plan.jobs.some((j) => j.jobId === 'deploy')).toBe(false);
    expect(plan.excluded).toEqual([{ jobId: 'deploy', reason: 'if condition is false' }]);
  });

  it('cascades exclusion to explicit dependents', () => {
    const yaml = `name: x\njobs:\n  a:\n    if: "event == 'schedule'"\n    steps: [x]\n  b:\n    needs: [a]\n    steps: [x]\n  c:\n    needs: [b]\n    steps: [x]\n`;
    const plan = compilePlan(spec(yaml), main);
    expect(plan.jobs).toEqual([]);
    expect(plan.excluded.map((e) => e.jobId)).toEqual(['a', 'b', 'c']);
    expect(plan.excluded[1]?.reason).toMatch(/needs 'a'/);
    expect(plan.criticalPath).toEqual([]);
  });

  it('evaluates conditions per matrix instance', () => {
    const yaml = `name: x\njobs:\n  t:\n    if: "matrix.os != 'mac' || branch == 'main'"\n    matrix:\n      os: [linux, mac]\n    steps: [x]\n`;
    expect(compilePlan(spec(yaml), feature).jobs.map((j) => j.key)).toEqual(['t[os=linux]']);
    expect(compilePlan(spec(yaml), main).jobs).toHaveLength(2);
  });

  it('skips over empty stages when resolving implicit needs', () => {
    const yaml = `name: x\nstages: [a, b, c]\njobs:\n  one:\n    stage: a\n    steps: [x]\n  two:\n    stage: b\n    if: "false"\n    steps: [x]\n  three:\n    stage: c\n    steps: [x]\n`;
    const plan = compilePlan(spec(yaml), main);
    expect(plan.jobs.find((j) => j.jobId === 'three')?.needs).toEqual(['one']);
  });

  it('treats needs: [] as "start immediately"', () => {
    const yaml = `name: x\nstages: [a, b]\njobs:\n  one:\n    stage: a\n    steps: [x]\n  two:\n    stage: b\n    needs: []\n    steps: [x]\n`;
    const plan = compilePlan(spec(yaml), main);
    expect(plan.levels).toEqual([['one', 'two']]);
  });

  it('interpolates step env and lets run reference it', () => {
    const yaml = `name: x\njobs:\n  a:\n    steps:\n      - run: echo \${{ env.GREETING }}\n        env:\n          GREETING: "hi \${{ branch }}"\n`;
    const step = compilePlan(spec(yaml), main).jobs[0]?.steps[0];
    expect(step?.env.GREETING).toBe('hi main');
    expect(step?.run).toBe('echo hi main');
  });

  it('refuses plans above the planned job limit', () => {
    const values = Array.from({ length: 16 }, (_, i) => i).join(', ');
    const jobs = Array.from(
      { length: 5 },
      (_, i) =>
        `  j${i}:\n    matrix:\n      a: [${values}]\n      b: [${values}]\n    steps: [x]\n`,
    ).join('');
    expect(() => compilePlan(spec(`name: x\njobs:\n${jobs}`), main)).toThrow(PlanError);
  });
});
