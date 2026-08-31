# @termwright/gherkin

## 0.3.0

### Minor Changes

- [#3](https://github.com/Gorce-AI/termwright/pull/3) [`df95e0b`](https://github.com/Gorce-AI/termwright/commit/df95e0b58bf03fec21aacbee75f8203b967d0d0d) Thanks [@SarukMyskam](https://github.com/SarukMyskam)! - BREAKING: replace the pre-release `test.scoped()` fixture-composition API with
  Vitest 4.1's `test.override()` API, without a compatibility alias.

  Gherkin-generated tests can now request typed custom fixtures from the same
  `test.extend()` runtime used by ordinary Vitest tests. Custom fixtures may
  depend on Termwright fixtures, keep native async setup/teardown ordering, and
  work through a custom `generatedImports.test` module.

### Patch Changes

- Updated dependencies [[`df95e0b`](https://github.com/Gorce-AI/termwright/commit/df95e0b58bf03fec21aacbee75f8203b967d0d0d), [`3b3d362`](https://github.com/Gorce-AI/termwright/commit/3b3d36201088e03307a23b1d5afb0dfc71d60cec)]:
  - @termwright/test@0.3.0

## 0.2.0

### Patch Changes

- Updated dependencies []:
  - @termwright/test@0.2.0
