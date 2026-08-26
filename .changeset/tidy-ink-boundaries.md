---
'@termwright/ink': patch
'@termwright/probe-ink': patch
---

Bind fixture rerender acknowledgements to the exact committed Ink host generation and add command identities so stale render callbacks or late control replies cannot acknowledge a newer rerender. Authenticate control peers before electing the fixture connection and isolate bounded per-peer input so strangers cannot reserve or poison the channel.
