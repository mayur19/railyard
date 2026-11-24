/** Demo pipelines used by the seed script and the web editor. Only harmless commands. */
export const STOREFRONT_PIPELINE = `version: 1
name: storefront-ci
on:
  push:
    branches: [main, "release/*"]
  schedule:
    - cron: "0 3 * * 1-5"
env:
  APP: storefront
stages: [build, test, deploy]
jobs:
  lint:
    stage: build
    steps:
      - name: lint sources
        run: |
          echo "linting \${{ env.APP }}"
          sleep 1
          printf '\\033[32m0 problems\\033[0m\\n'
  compile:
    stage: build
    steps:
      - name: compile
        run: |
          echo "compiling \${{ env.APP }} at \${{ sha }}"
          for i in 1 2 3; do echo "bundle chunk $i"; sleep 1; done
  unit:
    stage: test
    needs: [compile]
    matrix:
      node: [20, 22]
      shard: [1, 2]
      exclude:
        - node: 20
          shard: 2
    steps:
      - name: run tests
        run: |
          echo "node \${{ matrix.node }} / shard \${{ matrix.shard }}"
          sleep 2
          printf '\\033[1;32mPASS\\033[0m 42 tests\\n'
  smoke:
    stage: test
    allow-failure: true
    steps:
      - run: echo "smoke checks"; ls -la
  deploy:
    stage: deploy
    if: "branch == 'main'"
    environment: staging
    steps:
      - name: ship
        run: echo "deploying \${{ env.APP }} run \${{ run_number }}"
  notify-failure:
    stage: deploy
    needs: [unit]
    when: on_failure
    steps:
      - run: echo "unit tests failed on \${{ branch }}"
`;

export const PAYMENTS_PIPELINE = `version: 1
name: payments-ci
stages: [check, package]
jobs:
  typecheck:
    stage: check
    steps:
      - echo "typecheck ok"
  migrations:
    stage: check
    steps:
      - name: verify migrations
        run: |
          echo "checking migration order"
          echo "warning: slow migration detected" >&2
  package:
    stage: package
    retries: 1
    steps:
      - echo "packaging tarball"
`;
