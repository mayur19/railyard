/** Hard limits enforced by the validator and planner. Documented in docs/design/system-design.md. */
export const PIPELINE_LIMITS = {
  maxYamlBytes: 256 * 1024,
  maxJobs: 200,
  maxStepsPerJob: 100,
  maxStages: 30,
  maxMatrixAxes: 8,
  maxMatrixValuesPerAxis: 64,
  maxMatrixCombinations: 256,
  maxPlannedJobs: 1000,
  maxTimeoutMinutes: 24 * 60,
  maxRetries: 5,
  defaultTimeoutMinutes: 60,
  defaultStage: 'default',
} as const;

export const IDENTIFIER_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,62}$/;
export const ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
export const DURATION_PATTERN = /^(\d{1,4})(m|h|d|w)$/;
