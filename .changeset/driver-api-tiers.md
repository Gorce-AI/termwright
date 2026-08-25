---
"@termwright/driver": minor
"termwright": minor
---

BREAKING: narrow the supported driver root to application-facing terminal,
locator, action, observation, value-policy, and error APIs. Low-level PTY
backends, key/mouse encoders, selector parsers, process supervision, inherited
environment construction, and launch-resource injection now live exclusively
under `@termwright/driver/experimental`. The pre-stable API has no compatibility
re-exports or deprecated aliases.
