# termwright-probe-ratatui

The half of the Ratatui probe that needs `std`.

`ratatui-core` is `#![no_std]`. It gets `std` only because the `ratatui` facade
enables it, and a Ratatui application that uses the core crate alone may have
no `std` at all. Sockets, threads and the protocol client are therefore
impossible inside the patched crate, and everything that needs them lives here
instead.

The patched `ratatui-core` gains this crate as an **optional** dependency,
enabled by its own `std` feature, and calls into it from `Frame::render_widget`
behind `#[cfg(feature = "std")]`. Measured on `ratatui-core` 0.1.2: a
`--no-default-features` build compiles and does not pull this crate in at all,
so a `no_std` user gets a byte-identical build from a tool they never invoked.

Nothing here is called unless the application was launched with
`TERMWRIGHT_ENDPOINT` and `TERMWRIGHT_TOKEN`. Without them the hook returns on
its first branch and the application renders exactly what it would have
rendered alone.
