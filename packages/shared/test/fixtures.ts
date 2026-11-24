export const FULL_PIPELINE = `
version: 1
name: web-app
on:
  push:
    branches: [main, "release/*"]
  manual: true
  schedule:
    - cron: "0 3 * * 1-5"
env:
  APP: web
stages: [build, test, deploy]
jobs:
  lint:
    stage: build
    steps:
      - npm run lint
  compile:
    stage: build
    runs-on: linux
    env:
      TARGET: "\${{ env.APP }}-bundle"
    steps:
      - name: compile
        run: echo "compiling \${{ env.TARGET }} on \${{ branch }}"
  unit:
    stage: test
    needs: [compile]
    retries: 1
    matrix:
      node: [20, 22]
      shard: [1, 2]
      exclude:
        - node: 20
          shard: 2
      include:
        - node: 23
          shard: 1
          experimental: true
    steps:
      - run: echo "node \${{ matrix.node }} shard \${{ matrix.shard }}"
  e2e:
    stage: test
    allow-failure: true
    steps:
      - run: echo e2e
  deploy:
    stage: deploy
    if: "branch == 'main'"
    timeout-minutes: 15
    steps:
      - name: ship
        run: echo deploying
        timeout-minutes: 5
  notify:
    stage: deploy
    needs: [unit]
    when: on_failure
    steps:
      - run: echo "something failed"
`;

export const MINIMAL_PIPELINE = `
name: tiny
jobs:
  hello:
    steps:
      - echo hello
`;
