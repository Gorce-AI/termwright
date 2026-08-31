# @termwright/pty

Termwright's internal native pseudo-terminal implementation for macOS, Linux
and Windows. It is consumed by `@termwright/driver`; application tests should
normally install `termwright` or a framework adapter instead.

The POSIX backend owns its `forkpty()` master, reads until kernel EOF (including
Linux's PTY `EIO` end condition), preserves ordered input with native
backpressure, and owns the child's process group. The Windows backend owns its
ConPTY pipes and job object. Neither platform uses a timeout, retry, quiet
window, or a private field from another PTY package to decide that output has
ended.

Input is admitted to an ordered native queue capped at 8 MiB. Overflow is
rejected synchronously; an asynchronous OS write failure permanently closes
admission and is reported to the driver. Drain means every byte admitted before
that edge has left the native queue, not that the child has consumed it. Output
crosses a bounded 64-event native-to-JavaScript channel, so a busy JavaScript
consumer backpressures the pseudoterminal instead of growing memory without a
limit. Disposal aborts that channel before joining producers, preventing a
backpressure/teardown deadlock.

Prebuilt Node-API addons are selected through optional packages for macOS >=
13.5, glibc Linux at the Ubuntu 22.04 ABI floor (glibc >= 2.35), and Windows 10
version 1809 / Server 2019 or newer, on arm64 and x64. Every release artifact is compiled and
then exercised on the matching native host. Packaging also rejects a Darwin
deployment target other than 13.5 and Linux symbol requirements newer than the
Ubuntu 22.04 glibc/libstdc++ ABI floor. A missing or unloadable matching
addon fails closed with the attempted package paths in its diagnostic; there is
no fallback terminal implementation.

Windows packages include the pinned official Microsoft
`Microsoft.Windows.Console.ConPTY` runtime. The addon loads `vendor/conpty.dll`
by absolute path and uses one immutable function table for every operation on a
pseudoconsole. It validates the DLL and architecture-specific
`OpenConsole.exe` files before starting application code and never silently
falls back to the inbox conhost. The x64 package includes both x64 and ARM64
hosts because an x64 Node process can run under emulation on Windows ARM64 while
the pseudoconsole host should remain native.
Bundle discovery is exposed through `conPtyRuntimeInfo()` even when validation
fails, so diagnostics retain the exact failure code and Win32 status. Creating
a session still fails closed until every asset and core export is validated.
The report attests the canonically loaded DLL and the validated, locked host
candidate selected for the native architecture; it is not process-image
inspection of the spawned `OpenConsole.exe`. Inbox avoidance therefore rests
on strict side-by-side selection plus the packaged behavioral verdict, which
would fail on the legacy reordering path, rather than on a claimed host-PID
attestation the public ConPTY API cannot provide.

The runtime pin and SHA-256 inventory live in `conpty-assets.json`. Updating the
pin requires regenerating the checked-in assets with
`scripts/prepare-conpty-assets.mjs`, running the Windows causal-frame and
lifecycle suites on x64, ARM64, and x64-on-ARM64, and reviewing the packaged
license and SPDX record. Asset presence alone is not certification: the native
binding reports its provider and only a behaviorally certified passthrough
runtime may support authoritative semantic frame pairing.

ConHost screen-buffer inspection is intentionally not part of the Windows
contract. A native proof showed that the legacy inbox conhost could update
`CONOUT$` before its rendered VT delta reached the output pipe, while unknown
OSC markers took a separate path and could overtake that delta. The vendored
passthrough ConPTY removes that renderer path: client VT bytes share one ordered
stream, so a marker written after a framework flush is a causal boundary. The
Windows output boundary also removes ConPTY's structurally injected focus and
Win32-input `DECSET` sequences before bytes reach the driver. It preserves the
optional startup cursor-position query, DA1, and every original child sequence,
including an explicit disable followed by enable. The normalizer is split-safe
and releases an incomplete candidate verbatim before authoritative EOF.
The input side still honors the host's always-on Win32 Input Mode. Application
replies are therefore transported as synthesized Win32 `KEY_EVENT` records,
except for cursor-position reports: OpenConsole's public input parser consumes
a raw CPR while synchronizing its own shadow cursor and otherwise passes that
same raw CPR to the application. Startup host DA1/CPR ownership is identified
by the split-safe control-plane grammar and answered raw. This preserves both
runtime cursor recovery and application protocol without leaking printable
tails as keys. After the parser has seen Win32 Input Mode, a lone raw `ESC`
would remain a possible sequence prefix; the application-input seam therefore
sends the physical Escape key as an explicit Win32 record while leaving raw,
mouse, paste, and compound key bytes unchanged.
Consequently terminal mode evidence describes requests made by the application,
not modes ConPTY requires for its own control plane.

A marker must be written to the active screen buffer; activating an inactive
buffer publishes its stored contents synchronously, after which the marker is
written on that newly active handle. Markers written while a buffer is inactive
are deliberately not treated as observable boundaries. The
screen-buffer probe remains useful diagnostic evidence, never visual truth or a
publication barrier. Win32 exposes no stable public predicate that proves an
arbitrary console-output handle is the active buffer, so the marker primitive
does not pretend to diagnose that state synchronously: it stays on the
framework's exact handle, and an inactive-buffer render remains unpaired.

`writeWindowsConsoleMarker(fd, marker)` is the shared child-side primitive for
framework probes. It uses the renderer's exact console descriptor, temporarily
enables processed VT output, writes the complete marker synchronously through
`WriteConsoleW`, and restores the exact prior mode before returning. Ink,
OpenTUI, Bubble Tea, and tview therefore remain authoritative even when an
application disabled VT processing; non-console writers stay ordinary ordered
byte streams.
