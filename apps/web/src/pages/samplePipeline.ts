export const SAMPLE_PIPELINE = `version: 1
name: demo-ci
env:
  APP: demo
stages: [build, test, deploy]
jobs:
  lint:
    stage: build
    steps:
      - name: lint
        run: printf '\\033[32mlint ok\\033[0m\\n'
  compile:
    stage: build
    steps:
      - name: compile
        run: |
          for i in 1 2 3; do echo "compiling \${{ env.APP }} part $i"; sleep 1; done
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
      - run: echo "node \${{ matrix.node }} shard \${{ matrix.shard }}"; sleep 1
  deploy:
    stage: deploy
    if: "branch == 'main'"
    steps:
      - run: echo "deploying run \${{ run_number }}"
  notify:
    stage: deploy
    needs: [unit]
    when: on_failure
    steps:
      - run: echo "unit tests failed"
`;
