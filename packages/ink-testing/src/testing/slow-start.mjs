// A deterministic import delay for the fixture negotiation regression. Node
// completes `--import` modules before loading the runner entry point, so the
// Ink integration cannot attach until this module resolves.
await new Promise((resolve) => setTimeout(resolve, 750));
