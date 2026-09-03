---
'@termwright/gherkin': patch
'@termwright/test': patch
'termwright': patch
---

Physically isolate Termwright's certified Vitest 4 engine from a consumer's Vitest installation, including npm 10 installs alongside Vitest 5. Make `termwright doctor` inspect that embedded engine, and keep Gherkin definitions coupled only to Termwright's public test API.
