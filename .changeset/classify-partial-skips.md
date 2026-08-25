---
"@termwright/protocol": minor
"@termwright/run-history": minor
"@termwright/ui": minor
"termwright": minor
---

Preserve mixed pass/skip runs as the distinct amber `passed-with-skips`
verdict across the Native Host, journal, CLI, history, and Runner. A partial
skip exits successfully only when every observed skip and selected required
declaration matches the repository's exact reviewed policy; undeclared,
ambiguous, all-skipped, and stale-required cases remain non-certifying.
