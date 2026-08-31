# @termwright/resource-broker

## 0.3.0

### Patch Changes

- [#47](https://github.com/Gorce-AI/termwright/pull/47) [`c597c47`](https://github.com/Gorce-AI/termwright/commit/c597c474d83b191c002ab53600e90672c3b2edd6) Thanks [@SarukMyskam](https://github.com/SarukMyskam)! - Make local endpoint shutdown a causal barrier on Windows and POSIX. Accepted semantic sockets are now destroyed before listener completion, late connections are rejected during shutdown, and listener cleanup still completes when an individual socket teardown reports an error.

- [#3](https://github.com/Gorce-AI/termwright/pull/3) [`df95e0b`](https://github.com/Gorce-AI/termwright/commit/df95e0b58bf03fec21aacbee75f8203b967d0d0d) Thanks [@SarukMyskam](https://github.com/SarukMyskam)! - Consolidate authenticated local IPC framing, hostile-input decoding, typed
  envelopes, token comparison, and endpoint lifecycle into one shared transport.
  Journal shutdown now drains every already-received append before its close
  barrier resolves and reports persistence failures after endpoint cleanup.

- [#3](https://github.com/Gorce-AI/termwright/pull/3) [`df95e0b`](https://github.com/Gorce-AI/termwright/commit/df95e0b58bf03fec21aacbee75f8203b967d0d0d) Thanks [@SarukMyskam](https://github.com/SarukMyskam)! - Document the public installation, lifecycle, durability, authentication, and
  security contracts of the desktop host and native-host infrastructure packages.
- Updated dependencies [[`3b3d362`](https://github.com/Gorce-AI/termwright/commit/3b3d36201088e03307a23b1d5afb0dfc71d60cec), [`ccb017e`](https://github.com/Gorce-AI/termwright/commit/ccb017e7bd060c8a481cdc0e37e3ce1c13e816d2), [`b2f02fc`](https://github.com/Gorce-AI/termwright/commit/b2f02fcf6bd1c9ae0f2874c34fdb73cd19bd027e)]:
  - @termwright/protocol@0.3.0
