# `@termwright/conpty`

Termwright's internal Windows pseudo-terminal backend. It owns the ConPTY
pipes and a Windows job object so output completion and process-tree cleanup do
not depend on a drain timer.

Applications normally install `termwright` or `@termwright/driver`, not this
package directly. npm selects `@termwright/conpty-win32-x64` or
`@termwright/conpty-win32-arm64` as an optional platform dependency. Windows
has no fallback backend: if the matching prebuild is absent or cannot load,
Termwright fails closed with a diagnostic error.

The backend supports the same certified Node 22 and 24 lines as Termwright.
Repository contributors build it on Windows with `pnpm build:native`; users are
not expected to have a compiler.
