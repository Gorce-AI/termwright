# Compatibility registry

[`registry.json`](registry.json) is the single source of truth for framework
compatibility. It separates a package's declared range from versions actually
verified by fixtures/audits, and records both capability vocabularies carried
by the `hello` handshake:

- `probe.capabilities` describes observable probe facts (`hello.probe`);
- `probe.adapterCapabilityVariants` describes message features on `hello`.

Copy-based probes also list every checksummed module patch. Optional annotation
APIs and known limitations belong in the framework row rather than in a second
hand-maintained matrix.

Validate a change with:

```sh
pnpm run test:compatibility
```

The test compares package versions, patch manifests, framework detection and
runtime handshake declarations. The documentation site imports this JSON to
render `/reference/compatibility/` and publishes the same data at
`/compatibility/registry.json` with [`schema.json`](schema.json) beside it.
