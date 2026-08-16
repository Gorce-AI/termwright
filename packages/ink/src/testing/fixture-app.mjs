/**
 * Fixture application for the real-process tests.
 *
 * Runs in its own Node process against the *built* package, so the tests
 * exercise what a user would actually install: `semanticRender` writing real
 * frames and real markers to a real stdout pipe.
 *
 * Imports are dynamic on purpose. Some of what these tests prove depends on
 * global state that must exist *before* React's reconciler initialises — the
 * DevTools hook in particular is read once, at module init — and a static
 * import would run too early to set it up.
 *
 * Env:
 * - `TW_LABELS` — comma-separated labels, rendered one after another.
 * - `TW_STRICT_MODE=1` — wrap the app in `<StrictMode>`.
 * - `TW_DEVTOOLS_HOOK=1` — install a React DevTools hook stub first. Ink only
 *   registers a renderer when `DEV=true` *and* a DevTools server answers on
 *   port 8097, so a merely-present hook must stay untouched; the process exits
 *   3 if anything called into it, which would mean something registered
 *   behind the application's back.
 */

const wantsDevtools = process.env['TW_DEVTOOLS_HOOK'] === '1';
const wantsStrict = process.env['TW_STRICT_MODE'] === '1';

const hookCalls = { inject: 0, commits: 0 };

if (wantsDevtools) {
  globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    isDisabled: false,
    supportsFiber: true,
    renderers: new Map(),
    inject(internals) {
      hookCalls.inject += 1;
      this.renderers.set(hookCalls.inject, internals);
      return hookCalls.inject;
    },
    onCommitFiberRoot() {
      hookCalls.commits += 1;
    },
    onCommitFiberUnmount() {},
    onPostCommitFiberRoot() {},
    checkDCE() {},
  };
}

const React = await import('react');
const { Box, Text } = await import('ink');
const { semanticRender, useSemantic } = await import('../../dist/index.js');

const labels = (process.env['TW_LABELS'] ?? 'Approve,Reject').split(',');

function App({ label }) {
  const ref = React.useRef(null);
  useSemantic(ref, { role: 'button', name: label, testId: 'action' });

  return React.createElement(
    Box,
    { flexDirection: 'column' },
    React.createElement(Box, { ref }, React.createElement(Text, null, label)),
  );
}

const tree = (label) => {
  const app = React.createElement(App, { label });
  return wantsStrict ? React.createElement(React.StrictMode, null, app) : app;
};

const app = semanticRender(tree(labels[0]), {
  stdout: process.stdout,
  interactive: true,
  alternateScreen: true,
  patchConsole: false,
  exitOnCtrlC: false,
});

let index = 1;

const finish = () => {
  app.unmount();
  // Untouched-or-fail: nothing may register a renderer behind the app's back.
  const touched = hookCalls.inject > 0 || hookCalls.commits > 0;
  const exitCode = wantsDevtools && touched ? 3 : 0;
  process.stdout.write('', () => {
    process.exit(exitCode);
  });
};

const step = () => {
  if (index < labels.length) {
    app.rerender(tree(labels[index]));
    index += 1;
    setTimeout(step, 250);
    return;
  }
  finish();
};

setTimeout(step, 250);
