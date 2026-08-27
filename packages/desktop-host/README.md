# `@termwright/desktop-host`

The hardened Electron companion for Termwright's Runner UI. The `termwright ui`
command launches it when desktop mode is selected; application test suites
normally install and invoke `termwright`, not this package directly.

The host accepts exactly one authenticated loopback Runner URL over a private
control endpoint. It does not place that URL or its token in process arguments.
The renderer runs sandboxed with Node integration disabled, navigation and
requests restricted to the Runner origin, and a restrictive Content Security
Policy. Startup and shutdown both have explicit deadlines and failed launches
roll back the child process and control endpoint.

Host integrations can install it directly with
`pnpm add @termwright/desktop-host`. Runner users should install `termwright`
instead.

## Programmatic launch

```ts
import { launchDesktopHost } from '@termwright/desktop-host';

const host = await launchDesktopHost({
  url: 'http://127.0.0.1:43121/?token=<unguessable-runner-token>',
});

await host.close();
```

`launchDesktopHost()` validates the complete URL before Electron starts. Only
`http` loopback addresses with exactly one non-empty token are accepted. The
returned `close()` operation is idempotent; `closed` also resolves when the user
closes the window.

The package also exports the URL validator and immutable security-policy values
for host integrations and contract tests. Those exports describe the security
boundary; weakening them creates a shell-exposure risk and requires dedicated
security review.

Node.js 22 and 24 are supported. Electron is packaged and cached per platform
and architecture by the launcher; consumers should not depend on the cache
layout.
