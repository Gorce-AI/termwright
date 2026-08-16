/**
 * Semantic conformance fixture — origin spec §20.2, on `@termwright/ink`.
 *
 * It exercises the full published matrix in one screen: nested regions,
 * duplicate accessible names, buttons (one of them disabled), a textbox, a
 * modal dialog, a list with a selected item, a scrollable region with
 * `scrollOffset`/`scrollExtent`, focus that moves, and wide/combining/emoji
 * text. It renders in the alternate screen so the adapter may claim
 * `absolute-bounds`, which is what makes bounds and hit-testing assertable.
 *
 * Written with `React.createElement` rather than JSX on purpose: the fixture
 * has to be runnable as `node semantic-ink-app.mjs` from any suite, in any
 * language binding's CI, without a build step in front of it.
 *
 * Input is handled by the fixture itself instead of `useInput`, because the
 * suites drive it with real mouse reports and Ink's key parser would mangle
 * them. Clicks are resolved against the fixture's *own* measured layout — the
 * app decides what was hit, exactly as a real application does, so a passing
 * hit-testing test proves the driver aimed at the right cell.
 *
 * Keys: Tab cycles focus · Enter activates · Up/Down move the list selection or
 * scroll the log · `d` opens the modal · Escape dismisses it · `q` unmounts.
 * While the textbox holds focus, printable keys go into its value.
 */

import { createElement as h, useEffect, useRef, useState } from 'react';
import { Box, Text, measureElement, render as inkRender, useApp, useStdin } from 'ink';
import { semanticRender, useSemantic } from '@termwright/ink';
import { publishLog } from '@termwright/logs';

const FILES = ['readme.md', 'index.ts', 'ünïcode 日本語 😀', 'notes.txt', 'LICENSE'];
const LOG_LINES = Array.from({ length: 20 }, (_, index) => `log line ${index + 1}`);
const LOG_WINDOW = 4;
const FOCUS_ORDER = ['filter', 'save-main', 'list', 'save-sidebar'];

/** Measured bounds of the widgets, keyed by test id; the fixture's hit map. */
const hitboxes = new Map();

const INITIAL = {
  focus: 'filter',
  value: '',
  listIndex: 0,
  scrollOffset: 0,
  dialog: false,
  expanded: true,
  last: 'none',
};

function hitTest(row, column) {
  for (const [key, box] of hitboxes) {
    if (box === undefined) continue;
    if (row < box.row || row >= box.row + box.height) continue;
    if (column < box.column || column >= box.column + box.width) continue;
    return key;
  }
  return null;
}

/** Records an element's viewport rect so the fixture can hit-test its own layout. */
function useHitbox(ref, key) {
  // No dependency array: the layout of every element may change on any render,
  // and measuring is a synchronous Yoga read.
  useEffect(() => {
    const timer = setImmediate(() => {
      const node = ref.current;
      if (node === null || node === undefined) return;
      const measured = measureElement(node);
      if (measured.width <= 0 || measured.height <= 0) return;
      hitboxes.set(key, {
        row: measured.y,
        column: measured.x,
        width: measured.width,
        height: measured.height,
      });
    });
    return () => clearImmediate(timer);
  });
}

/** A `<Box>` that is both semantically annotated and hit-testable. */
function Node({ meta, testKey, children, ...box }) {
  const ref = useRef(null);
  useSemantic(ref, meta);
  useHitbox(ref, testKey ?? meta.testId ?? meta.name);
  return h(Box, { ref, ...box }, children);
}

function App() {
  const { exit } = useApp();
  const { stdin, setRawMode } = useStdin();
  const [state, setState] = useState(INITIAL);
  const lastClick = useRef({ key: null, at: 0 });

  useEffect(() => {
    setRawMode(true);
    const onData = (chunk) => {
      // A single read can carry several events — the driver writes a whole
      // wheel gesture or a click's press+release in one go — so the chunk is
      // tokenised instead of being treated as one event.
      setState((current) => tokenize(chunk.toString('utf8')).reduce(reduce, current));
    };
    stdin.on('data', onData);
    return () => {
      stdin.off('data', onData);
    };
  }, [stdin, setRawMode, exit]);

  /** Folds one input event into the next state. Pure apart from `exit`. */
  function reduce(current, text) {
    const report = /^\x1b\[<(\d+);(\d+);(\d+)([Mm])/u.exec(text);
    if (report !== null) return pointer(current, report);
    if (text === '\t') {
      const next = FOCUS_ORDER[(FOCUS_ORDER.indexOf(current.focus) + 1) % FOCUS_ORDER.length];
      return { ...current, focus: next };
    }
    if (text === '\x1b') {
      return current.dialog ? { ...current, dialog: false, focus: 'save-main', last: 'DISMISSED' } : current;
    }
    if (text === '\r') return activate(current);
    if (text === '\x1b[A') return move(current, -1);
    if (text === '\x1b[B') return move(current, 1);
    if (current.focus === 'filter' && current.dialog === false) {
      if (text === '\x7f') return { ...current, value: current.value.slice(0, -1) };
      if (text >= ' ') return { ...current, value: current.value + text };
      return current;
    }
    if (text === 'l') {
      // A TUI cannot print diagnostics without corrupting its own render, so
      // this goes to the log channel and must NOT reach the screen. The suite
      // asserts both halves of that.
      publishLog({ level: 'warn', message: 'conformance log record', logger: 'fixture' });
      return { ...current, last: 'LOGGED' };
    }
    if (text === 'd') return { ...current, dialog: true, focus: 'dialog-approve' };
    if (text === 'e') return { ...current, expanded: !current.expanded };
    if (text === 'q') {
      exit();
      return current;
    }
    return current;
  }

  function activate(current) {
    if (current.dialog) {
      return { ...current, dialog: false, focus: 'save-main', last: `ACTIVATED ${current.focus}` };
    }
    return { ...current, last: `ACTIVATED ${current.focus}` };
  }

  function move(current, delta) {
    if (current.dialog) {
      return { ...current, focus: current.focus === 'dialog-approve' ? 'dialog-reject' : 'dialog-approve' };
    }
    if (current.focus === 'list') {
      const listIndex = Math.min(FILES.length - 1, Math.max(0, current.listIndex + delta));
      return { ...current, listIndex };
    }
    return { ...current, scrollOffset: clampScroll(current.scrollOffset + delta) };
  }

  function pointer(current, report) {
    const button = Number(report[1]);
    const column = Number(report[2]) - 1;
    const row = Number(report[3]) - 1;
    const released = report[4] === 'm';
    const key = hitTest(row, column);

    if (button >= 64) {
      const delta = button === 64 ? -1 : 1;
      if (key === 'log') return { ...current, scrollOffset: clampScroll(current.scrollOffset + delta), last: 'WHEEL log' };
      return { ...current, last: `WHEEL ${key ?? 'outside'}` };
    }
    if (button >= 32) {
      // Motion while a button is held: an application-owned selection drag.
      return { ...current, last: `DRAG ${row},${column}` };
    }
    if (released) return current;

    const now = Date.now();
    const double = lastClick.current.key === key && now - lastClick.current.at < 500;
    lastClick.current = { key, at: now };
    if (key === null) return { ...current, last: 'CLICK outside' };

    const focus = FOCUS_ORDER.includes(key) ? key : current.focus;
    const listIndex = key.startsWith('file-') ? Number(key.slice(5)) : current.listIndex;
    return {
      ...current,
      focus: key.startsWith('file-') ? 'list' : focus,
      listIndex,
      last: `${double ? 'DBLCLICK' : 'CLICK'} ${key}`,
    };
  }

  const visibleLog = LOG_LINES.slice(state.scrollOffset, state.scrollOffset + LOG_WINDOW);

  return h(
    Box,
    { flexDirection: 'column' },
    h(
      Node,
      { key: 'heading', meta: { role: 'heading', name: 'Termwright Conformance', state: { level: 1 } } },
      h(Text, null, 'Termwright Conformance'),
    ),
    h(
      Box,
      { key: 'body', flexDirection: 'row' },
      h(
        Node,
        {
          key: 'sidebar',
          meta: { role: 'region', name: 'Sidebar', testId: 'sidebar' },
          flexDirection: 'column',
          width: 24,
        },
        h(
          Node,
          {
            key: 'filters',
            meta: {
              role: 'region',
              name: 'Filters',
              testId: 'filters',
              state: { expanded: state.expanded },
            },
            flexDirection: 'column',
          },
          h(
            Node,
            {
              key: 'save',
              meta: {
                role: 'button',
                name: 'Save',
                testId: 'save-sidebar',
                state: { focused: state.focus === 'save-sidebar' },
              },
              testKey: 'save-sidebar',
            },
            h(Text, null, state.focus === 'save-sidebar' ? '[Save]' : ' Save '),
          ),
        ),
        h(
          Node,
          {
            key: 'delete',
            meta: { role: 'button', name: 'Delete', testId: 'delete', state: { disabled: true } },
          },
          h(Text, { dimColor: true }, ' Delete '),
        ),
      ),
      h(
        Node,
        { key: 'content', meta: { role: 'region', name: 'Content', testId: 'content' }, flexDirection: 'column' },
        h(
          Node,
          {
            key: 'filter',
            meta: {
              role: 'textbox',
              name: 'Filter',
              testId: 'filter',
              value: state.value,
              state: { focused: state.focus === 'filter' },
            },
            testKey: 'filter',
          },
          h(Text, null, `Filter: ${state.value}_`),
        ),
        h(
          Node,
          {
            key: 'save-main',
            meta: {
              role: 'button',
              name: 'Save',
              testId: 'save-main',
              state: { focused: state.focus === 'save-main' },
            },
            testKey: 'save-main',
          },
          h(Text, null, state.focus === 'save-main' ? '[Save]' : ' Save '),
        ),
        h(
          Node,
          {
            key: 'list',
            meta: {
              role: 'list',
              name: 'Files',
              testId: 'list',
              state: { orientation: 'vertical', setSize: FILES.length, focused: state.focus === 'list' },
            },
            testKey: 'list',
            flexDirection: 'column',
          },
          FILES.map((file, index) =>
            h(
              Node,
              {
                key: file,
                testKey: `file-${index}`,
                meta: {
                  role: 'listitem',
                  name: file,
                  testId: `file-${index}`,
                  state: {
                    selected: state.listIndex === index,
                    positionInSet: index + 1,
                    setSize: FILES.length,
                  },
                },
              },
              h(Text, null, `${state.listIndex === index ? '*' : ' '}${file}`),
            ),
          ),
        ),
        h(
          Node,
          {
            key: 'unnamed-region',
            // Deliberately annotated with a role and a test id but NO name,
            // wrapping text: a container must not take the text of what it
            // contains, or every ancestor of a label becomes a match for it.
            meta: { role: 'region', testId: 'unnamed-region' },
          },
          h(Text, null, 'Nested label'),
        ),
        h(
          Node,
          {
            key: 'unicode',
            // A ZWJ sequence, a combining mark and a CJK pair, kept out of any
            // bordered container: Yoga and the emulator do not always agree on
            // the width of a ZWJ cluster, and this fixture measures that
            // disagreement rather than being broken by it.
            meta: { role: 'text', name: 'unicode sample', testId: 'unicode', value: 'é 日本語 👩‍👩‍👧' },
          },
          h(Text, null, 'é 日本語 👩‍👩‍👧'),
        ),
        h(
          Node,
          {
            key: 'log',
            meta: {
              role: 'region',
              name: 'Log',
              testId: 'log',
              state: { scrollOffset: state.scrollOffset, scrollExtent: LOG_LINES.length },
            },
            testKey: 'log',
            flexDirection: 'column',
          },
          visibleLog.map((line) => h(Text, { key: line }, line)),
        ),
      ),
    ),
    h(
      Node,
      { key: 'status', meta: { role: 'status', name: state.last, testId: 'status' } },
      h(Text, null, `last: ${state.last}`),
    ),
    state.dialog
      ? h(
          Node,
          {
            key: 'dialog',
            meta: { role: 'dialog', name: 'Confirm', testId: 'dialog', state: { modal: true } },
            flexDirection: 'column',
            borderStyle: 'round',
          },
          h(Text, { key: 'prompt' }, 'Delete 日本語 é 😀 ?'),
          h(
            Node,
            {
              key: 'approve',
              testKey: 'dialog-approve',
              meta: {
                role: 'button',
                name: 'Approve',
                testId: 'dialog-approve',
                state: { focused: state.focus === 'dialog-approve' },
              },
            },
            h(Text, null, state.focus === 'dialog-approve' ? '[Approve]' : ' Approve '),
          ),
          h(
            Node,
            {
              key: 'reject',
              testKey: 'dialog-reject',
              meta: {
                role: 'button',
                name: 'Reject',
                testId: 'dialog-reject',
                state: { focused: state.focus === 'dialog-reject' },
              },
            },
            h(Text, null, state.focus === 'dialog-reject' ? '[Reject]' : ' Reject '),
          ),
        )
      : null,
  );
}

/**
 * Splits a raw read into individual events.
 *
 * A pseudo-terminal coalesces writes freely, so two keystrokes sent one after
 * the other routinely arrive as one chunk. Treating a chunk as one event would
 * silently drop the second key — and make every multi-key test flaky rather
 * than failing.
 */
function tokenize(text) {
  const events = [];
  let rest = text;
  while (rest.length > 0) {
    const escape = /^\x1b(?:\[[0-9;?<]*[ -/]*[@-~]|O[@-~])?/u.exec(rest);
    if (escape !== null && escape[0].length > 0) {
      events.push(escape[0]);
      rest = rest.slice(escape[0].length);
      continue;
    }
    const head = [...rest][0] ?? rest[0];
    events.push(head);
    rest = rest.slice(head.length);
  }
  return events;
}

function clampScroll(value) {
  return Math.min(LOG_LINES.length - LOG_WINDOW, Math.max(0, value));
}

// Mouse reporting is the fixture's own decision, exactly as in a real app: the
// driver refuses pointer actions until the program asks for them.
process.stdout.write('\x1b[?1002h\x1b[?1006h');

const renderFn = process.env['TERMWRIGHT_CONFORMANCE_PLAIN'] === '1' ? inkRender : semanticRender;
const app = renderFn(h(App), { alternateScreen: true, interactive: true, exitOnCtrlC: true });

await app.waitUntilExit();
process.stdout.write('\x1b[?1002l\x1b[?1006l');
process.stdout.write('BYE\r\n');
