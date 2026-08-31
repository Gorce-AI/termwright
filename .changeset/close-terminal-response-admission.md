---
'@termwright/driver': patch
---

Close emulator-generated terminal-response forwarding at the causal process
tree and PTY-input boundaries. Delayed xterm replies can no longer race native
Windows PTY disposal, while real response-write failures remain explicit
infrastructure failures.
