---
"@termwright/gherkin": minor
"@termwright/test": minor
"termwright": minor
---

BREAKING: replace the pre-release `test.scoped()` fixture-composition API with
Vitest 4.1's `test.override()` API, without a compatibility alias.

Gherkin-generated tests can now request typed custom fixtures from the same
`test.extend()` runtime used by ordinary Vitest tests. Custom fixtures may
depend on Termwright fixtures, keep native async setup/teardown ordering, and
work through a custom `generatedImports.test` module.
