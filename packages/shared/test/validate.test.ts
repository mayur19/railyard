import { describe, expect, it } from 'vitest';
import { validatePipelineYaml } from '../src/pipeline/validate.js';
import { FULL_PIPELINE, MINIMAL_PIPELINE } from './fixtures.js';

function errorsOf(yaml: string) {
  return validatePipelineYaml(yaml).issues.filter((i) => i.severity === 'error');
}

function codes(yaml: string) {
  return errorsOf(yaml).map((i) => i.code);
}

const job = (body: string, extra = '') => `name: p\n${extra}jobs:\n  a:\n${body}`;

describe('validatePipelineYaml - happy paths', () => {
  it('accepts a full-featured pipeline', () => {
    const result = validatePipelineYaml(FULL_PIPELINE);
    expect(errorsOf(FULL_PIPELINE)).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.spec?.jobs.map((j) => j.id)).toEqual([
      'lint',
      'compile',
      'unit',
      'e2e',
      'deploy',
      'notify',
    ]);
    expect(result.spec?.triggers.schedule).toEqual([{ cron: '0 3 * * 1-5' }]);
    expect(result.spec?.triggers.push?.branches).toEqual(['main', 'release/*']);
    const unit = result.spec?.jobs.find((j) => j.id === 'unit');
    expect(unit?.matrix?.exclude).toEqual([{ node: 20, shard: 2 }]);
    expect(unit?.retries).toBe(1);
  });

  it('applies defaults to a minimal pipeline', () => {
    const result = validatePipelineYaml(MINIMAL_PIPELINE);
    expect(result.ok).toBe(true);
    const spec = result.spec;
    expect(spec?.stages).toEqual(['default']);
    expect(spec?.triggers).toEqual({ push: null, manual: true, schedule: [] });
    expect(spec?.jobs[0]).toMatchObject({
      stage: 'default',
      needs: null,
      when: 'on_success',
      timeoutMinutes: 60,
      retries: 0,
      allowFailure: false,
      runsOn: [],
    });
    expect(spec?.jobs[0]?.steps[0]).toMatchObject({
      name: 'echo hello',
      run: 'echo hello',
      continueOnError: false,
    });
  });

  it('warns about features that are validated but not executed yet', () => {
    const yaml = job(
      `    environment: production\n    concurrency: deploy-prod\n    cache:\n      key: npm\n      paths: [node_modules]\n    artifacts:\n      paths: [dist]\n      expire-in: 2w\n    steps: [echo hi]\n`,
    );
    const result = validatePipelineYaml(yaml);
    expect(result.ok).toBe(true);
    expect(result.issues.filter((i) => i.severity === 'warning').map((i) => i.path)).toEqual([
      'jobs.a.cache',
      'jobs.a.artifacts',
      'jobs.a.environment',
      'jobs.a.concurrency',
    ]);
  });

  it('defaults artifact expiry and accepts single needs string', () => {
    const yaml = `name: p\njobs:\n  a:\n    steps: [x]\n  b:\n    needs: a\n    artifacts:\n      paths: [out]\n    steps: [y]\n`;
    const result = validatePipelineYaml(yaml);
    expect(result.spec?.jobs[1]?.needs).toEqual(['a']);
    expect(result.spec?.jobs[1]?.artifacts?.expireIn).toBe('7d');
  });
});

describe('validatePipelineYaml - structural errors', () => {
  it('reports YAML syntax errors with positions', () => {
    const result = validatePipelineYaml('name: x\njobs: [\n');
    expect(result.ok).toBe(false);
    expect(result.issues[0]).toMatchObject({ code: 'yaml_syntax' });
    expect(result.issues[0]?.line).toBeGreaterThan(0);
  });

  it('rejects duplicate keys', () => {
    expect(codes('name: a\nname: b\njobs:\n  a:\n    steps: [x]\n')).toContain('yaml_syntax');
  });

  it('rejects oversized files', () => {
    expect(codes(`name: x\n# ${'x'.repeat(300 * 1024)}\n`)).toEqual(['yaml_too_large']);
  });

  it.each([
    ['- just a list', 'type'],
    ['name: x', 'required'],
    ['name: x\njobs: []', 'type'],
    ['name: x\njobs: {}', 'empty'],
    ['name: x\nversion: 2\njobs:\n  a:\n    steps: [x]', 'unsupported_version'],
    ['name: x\nbogus: 1\njobs:\n  a:\n    steps: [x]', 'unknown_key'],
    ['jobs:\n  a:\n    steps: [x]', 'required'],
    ['name: 5\njobs:\n  a:\n    steps: [x]', 'type'],
    ["name: '   '\njobs:\n  a:\n    steps: [x]", 'empty'],
    ['name: x\nstages: []\njobs:\n  a:\n    steps: [x]', 'empty'],
    ['name: x\nstages: [a, a]\njobs:\n  a:\n    stage: a\n    steps: [x]', 'duplicate'],
    ['name: x\nstages: ["bad stage"]\njobs:\n  a:\n    steps: [x]', 'pattern'],
    ['name: x\nstages: oops\njobs:\n  a:\n    steps: [x]', 'type'],
    ['name: x\nenv: [1]\njobs:\n  a:\n    steps: [x]', 'type'],
    ['name: x\nenv:\n  "1BAD": x\njobs:\n  a:\n    steps: [x]', 'pattern'],
    ['name: x\nenv:\n  OK: [1]\njobs:\n  a:\n    steps: [x]', 'type'],
  ])('%s -> %s', (yaml, code) => {
    expect(codes(yaml)).toContain(code);
  });

  it.each([
    ['    steps: []\n', 'empty'],
    ['    name: x\n', 'required'],
    ['    steps: oops\n', 'type'],
    ['    steps: [1]\n', 'type'],
    ['    steps:\n      - name: no run\n', 'required'],
    ['    steps:\n      - run: x\n        shell: zsh\n', 'unknown_key'],
    ['    steps:\n      - run: x\n        working-directory: ../escape\n', 'unsafe_path'],
    ['    steps:\n      - run: x\n        timeout-minutes: 0\n', 'range'],
    ['    steps:\n      - run: x\n        continue-on-error: "yes"\n', 'type'],
    ['    timeout-minutes: 2000\n    steps: [x]\n', 'range'],
    ['    timeout-minutes: 1.5\n    steps: [x]\n', 'type'],
    ['    retries: 9\n    steps: [x]\n', 'range'],
    ['    when: sometimes\n    steps: [x]\n', 'enum'],
    ['    allow-failure: 1\n    steps: [x]\n', 'type'],
    ['    runs-on: [linux, linux]\n    steps: [x]\n', 'duplicate'],
    ['    runs-on: 5\n    steps: [x]\n', 'type'],
    ['    environment: "prod env"\n    steps: [x]\n', 'pattern'],
    ['    cache: yes\n    steps: [x]\n', 'type'],
    ['    cache:\n      paths: [a]\n    steps: [x]\n', 'required'],
    ['    cache:\n      key: k\n      paths: []\n    steps: [x]\n', 'empty'],
    ['    cache:\n      key: k\n    steps: [x]\n', 'required'],
    ['    artifacts:\n      paths: [/etc/passwd]\n    steps: [x]\n', 'unsafe_path'],
    ['    artifacts:\n      paths: [dist]\n      expire-in: forever\n    steps: [x]\n', 'pattern'],
    ['    artifacts: [dist]\n    steps: [x]\n', 'type'],
    ['    name: "' + 'n'.repeat(101) + '"\n    steps: [x]\n', 'too_long'],
    ['    if: "branch =="\n    steps: [x]\n', 'expression_syntax'],
    ['    if: "secrets.TOKEN"\n    steps: [x]\n', 'unknown_reference'],
    ['    steps:\n      - run: echo ${{ matrix.node }}\n', 'unknown_reference'],
    ['    steps:\n      - run: echo ${{ env.MISSING }}\n', 'unknown_reference'],
    ['    steps:\n      - run: echo ${{ broken\n', 'expression_syntax'],
    ['    stage: nowhere\n    steps: [x]\n', 'unknown_stage'],
  ])('job %j -> %s', (body, code) => {
    expect(codes(job(body))).toContain(code);
  });

  it('rejects non-map jobs and invalid job ids', () => {
    expect(codes('name: x\njobs:\n  a: 5\n')).toContain('type');
    expect(codes('name: x\njobs:\n  "9lives":\n    steps: [x]\n')).toContain('pattern');
  });

  it('attaches line numbers to nested issues', () => {
    const yaml = 'name: x\njobs:\n  a:\n    steps:\n      - run: x\n        timeout-minutes: 0\n';
    const issue = errorsOf(yaml)[0];
    expect(issue?.path).toBe('jobs.a.steps[0].timeout-minutes');
    expect(issue?.line).toBe(6);
  });

  it('reports multiple independent errors at once', () => {
    const yaml = job('    retries: 9\n    when: x\n    steps: []\n');
    expect(codes(yaml).sort()).toEqual(['empty', 'enum', 'range']);
  });
});

describe('validatePipelineYaml - triggers', () => {
  it.each([
    ['on: 5', 'type'],
    ['on:\n  pull_request: {}', 'unknown_key'],
    ['on:\n  push: yes', 'type'],
    ['on:\n  push:\n    tags: [v1]', 'unknown_key'],
    ['on:\n  manual: "no"', 'type'],
    ['on:\n  schedule: "0 * * * *"', 'type'],
    ['on:\n  schedule: [5]', 'type'],
    ['on:\n  schedule:\n    - cron: "61 * * * *"', 'invalid_cron'],
    ['on:\n  schedule:\n    - {}', 'required'],
  ])('%s -> %s', (trigger, code) => {
    expect(codes(`name: x\n${trigger}\njobs:\n  a:\n    steps: [x]\n`)).toContain(code);
  });

  it('defaults push branches to all branches', () => {
    const result = validatePipelineYaml('name: x\non:\n  push: {}\njobs:\n  a:\n    steps: [x]\n');
    expect(result.spec?.triggers.push?.branches).toEqual(['*']);
  });
});

describe('validatePipelineYaml - dependency graph', () => {
  it('detects unknown, self and later-stage needs', () => {
    const yaml = `name: x\nstages: [one, two]\njobs:\n  a:\n    stage: one\n    needs: [a, ghost, b]\n    steps: [x]\n  b:\n    stage: two\n    steps: [x]\n`;
    expect(codes(yaml).sort()).toEqual(['later_stage', 'self_dependency', 'unknown_job']);
  });

  it('detects cycles and prints the path', () => {
    const yaml = `name: x\njobs:\n  a:\n    needs: [c]\n    steps: [x]\n  b:\n    needs: [a]\n    steps: [x]\n  c:\n    needs: [b]\n    steps: [x]\n`;
    const cycle = errorsOf(yaml).find((i) => i.code === 'cycle');
    expect(cycle?.message).toMatch(/dependency cycle: (\w -> ){3}\w/);
  });
});

describe('validatePipelineYaml - matrix', () => {
  it.each([
    ['    matrix: [1]\n', 'type'],
    ['    matrix: {}\n', 'empty'],
    ['    matrix:\n      node: []\n', 'type'],
    ['    matrix:\n      node: [20, 20]\n', 'duplicate'],
    ['    matrix:\n      node: [[1]]\n', 'type'],
    ['    matrix:\n      "bad axis": [1]\n', 'pattern'],
    ['    matrix:\n      node: [20]\n      exclude: [{ os: linux }]\n', 'unknown_axis'],
    ['    matrix:\n      node: [20]\n      exclude: [{ node: 20 }]\n', 'empty_matrix'],
    ['    matrix:\n      node: [20]\n      include: [5]\n', 'type'],
    ['    matrix:\n      node: [20]\n      include: oops\n', 'type'],
    ['    matrix:\n      node: [20]\n      include: [{ "bad key": 1 }]\n', 'pattern'],
    ['    matrix:\n      node: [20]\n      include: [{ k: [1] }]\n', 'type'],
  ])('%j -> %s', (matrix, code) => {
    expect(codes(job(`${matrix}    steps: [x]\n`))).toContain(code);
  });

  it('rejects matrices that expand beyond the limit', () => {
    const values = Array.from({ length: 17 }, (_, i) => i).join(', ');
    const yaml = job(`    matrix:\n      a: [${values}]\n      b: [${values}]\n    steps: [x]\n`);
    expect(errorsOf(yaml).find((i) => i.code === 'matrix_too_large')?.message).toMatch(
      /289 combinations/,
    );
  });

  it('rejects too many axes and values', () => {
    const axes = Array.from({ length: 9 }, (_, i) => `      a${i}: [1]`).join('\n');
    expect(codes(job(`    matrix:\n${axes}\n    steps: [x]\n`))).toContain('too_many');
    const many = Array.from({ length: 65 }, (_, i) => i).join(', ');
    expect(codes(job(`    matrix:\n      a: [${many}]\n    steps: [x]\n`))).toContain('too_many');
  });

  it('allows matrix references to include-only keys', () => {
    const yaml = job(
      `    matrix:\n      node: [20]\n      include: [{ node: 20, label: lts }]\n    steps:\n      - echo \${{ matrix.label }}\n`,
    );
    expect(errorsOf(yaml)).toEqual([]);
  });
});
