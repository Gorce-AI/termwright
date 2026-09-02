# @termwright/gherkin

## 0.3.2

### Patch Changes

- Updated dependencies []:
  - @termwright/test@0.3.2

## 0.3.1

### Patch Changes

- Updated dependencies []:
  - @termwright/test@0.3.1

## 0.3.0

### Minor Changes

- [#106](https://github.com/Gorce-AI/termwright/pull/106) [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e) Thanks [@SarukMyskam](https://github.com/SarukMyskam)! - BREAKING: replace the pre-release `test.scoped()` fixture-composition API with
  Vitest 4.1's `test.override()` API, without a compatibility alias.

  Gherkin-generated tests can now request typed custom fixtures from the same
  `test.extend()` runtime used by ordinary Vitest tests. Custom fixtures may
  depend on Termwright fixtures, keep native async setup/teardown ordering, and
  work through a custom `generatedImports.test` module.

### Patch Changes

- Updated dependencies [[`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e), [`e0b78f5`](https://github.com/Gorce-AI/termwright/commit/e0b78f525888014f8ea08d3817abbeb407c3df6e)]:
  - @termwright/test@0.3.0

## 0.2.0

### Patch Changes

- Updated dependencies []:
  - @termwright/test@0.2.0
