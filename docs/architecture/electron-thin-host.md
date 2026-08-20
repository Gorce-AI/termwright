# Electron thin host for `termwright ui`

**Status:** shipped; desktop is the default interactive surface.

**Last verified:** 2026-08-21

## Decision

The desktop app is a thin native host for the same authenticated loopback URL
and React bundle served by `@termwright/ui`. It does not own Vitest, PTYs,
traces, application state, or a second renderer implementation.

```text
termwright CLI
├── Vitest watcher and targeted runs
├── @termwright/ui HTTP/WebSocket server
└── Termwright desktop host
    └── sandboxed BrowserWindow -> the same renderer URL
```

`packages/desktop-host` owns Electron startup, packaging, the native icon,
security policy, fuses, and host lifecycle. `packages/termwright-cli` chooses
the surface and coordinates shutdown. `packages/ui` remains the sole owner of
the server and visual application.

## Surface selection

```ts
type UiSurface = 'desktop' | 'browser' | 'none';
```

- interactive `termwright ui` selects `desktop`;
- `--browser` selects the system browser;
- `--no-open`, JSON output, CI, and non-TTY output select `none`;
- desktop loads only the exact loopback origin created for that launch.

Closing the desktop window closes the server and Vitest watcher. Shutdown is
idempotent so a concurrent process exit does not leave a watcher behind.

## Bootstrap and authentication

The CLI passes bootstrap data through a private owner-only Unix socket or named
pipe. The token-bearing URL is absent from host arguments, environment, window
title, and logs. The host acknowledges readiness before the CLI treats the
surface as open.

The normal UI server token remains mandatory. Electron does not bypass HTTP or
WebSocket authorization.

## BrowserWindow policy

The production window:

- has Node integration disabled;
- uses context isolation and Chromium sandboxing;
- has no preload or renderer IPC;
- denies unexpected navigation, windows, webviews, permissions, and downloads;
- restricts HTTP and WebSocket traffic to the exact Runner origin;
- uses the production Content Security Policy;
- uses a non-persistent session partition;
- does not forward renderer-controlled values to `shell.openExternal`.

Electron fuses disable Run-as-Node, `NODE_OPTIONS`, CLI inspector flags, and
file privileges. Only-ASAR is enabled. Cookie encryption and WASM are enabled.
ASAR integrity and a browser-specific V8 startup snapshot are not enabled in the
npm-packaged host because those Electron artifacts do not include the required
integrity metadata or specialized snapshot; enabling either prevents the host
from reaching main-process startup.

## Packaging

The build generates PNG, ICNS, and ICO assets deterministically from the
canonical Termwright SVG. A fingerprinted platform cache contains a native
`Termwright` bundle with ASAR, product name, executable name, bundle id, and
icon. The desktop package is a normal dependency of the umbrella CLI.

Native PTY dependencies remain in the Node CLI/server process and do not need
an Electron ABI rebuild.

## Release gates

- host and CLI typechecks, builds, and unit tests;
- package-content and dependency checks;
- native packaged launch on supported desktop platforms;
- product name and icon verification;
- token absence from process arguments and environment;
- BrowserWindow policy and fuse verification;
- watcher and server shutdown when the window closes;
- the normal Runner browser suite against the shared React application.
