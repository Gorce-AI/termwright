---
'@termwright/protocol': patch
---

Preserve test values by default and make artifact redaction an explicit opt-in. Trace redaction now redacts application text without changing protocol fields, so inputs such as `work` cannot corrupt enum values such as `framework`. MCP manual recording accepts `record: { redact: true }` when a shareable redacted trace is needed.
