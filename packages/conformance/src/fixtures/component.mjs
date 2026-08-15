/**
 * The component under test for the component-harness matrix — origin spec
 * §20.2a. It is deliberately a plain ESM module with no side effects at import
 * time, so the *same* component can be mounted in-process by a component
 * harness (`@termwright/ink-testing`) and as a real child process by
 * `component-app.mjs`, and the two outcomes compared.
 *
 * It covers, in one component: a wrapper/context dependency, prop-driven
 * rerender, a callback fired by physical input, async state settling after
 * mount, focus transfer between two widgets, and an error boundary that
 * replaces the subtree with an `alert` when a child throws.
 */

import { createElement as h, Component, createContext, useContext, useEffect, useRef, useState } from 'react';
import { Box, Text, useStdin, useStdout } from 'ink';
import { useSemantic } from '@termwright/ink';

/** Wrapper context: the prefix every label is rendered with. */
export const LabelContext = createContext('probe');

/** An annotated `<Box>`; the harness and the PTY fixture render the same one. */
function Node({ meta, children, ...box }) {
  const ref = useRef(null);
  useSemantic(ref, meta);
  return h(Box, { ref, ...box }, children);
}

class Boundary extends Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return h(
      Node,
      { meta: { role: 'alert', name: 'Component crashed', testId: 'crashed' } },
      h(Text, null, 'Component crashed'),
    );
  }
}

function Exploder({ boom }) {
  if (boom) throw new Error('probe exploded on purpose');
  return null;
}

/**
 * The probe component.
 *
 * @param step - prop-driven increment size; changing it proves prop rerender.
 * @param onChange - called with the new count after every physical `+`/`-`.
 */
export function Probe({ step = 1, onChange }) {
  const prefix = useContext(LabelContext);
  const { stdin, setRawMode } = useStdin();
  const { stdout } = useStdout();
  const [count, setCount] = useState(0);
  const [focus, setFocus] = useState('increment');
  const [phase, setPhase] = useState('loading');
  const [boom, setBoom] = useState(false);

  // Async state: nothing about the first frame says "ready", so a test that
  // asserts on it has to wait for a later revision rather than a sleep.
  useEffect(() => {
    const timer = setTimeout(() => setPhase('ready'), 50);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    setRawMode(true);
    const onData = (chunk) => {
      const text = chunk.toString('utf8');
      if (text === '\t') setFocus((current) => (current === 'increment' ? 'decrement' : 'increment'));
      if (text === 'e') setBoom(true);
      if (text === '+' || text === '-') {
        setCount((current) => {
          const next = current + (text === '+' ? step : -step);
          onChange?.(next);
          return next;
        });
      }
    };
    stdin.on('data', onData);
    return () => {
      stdin.off('data', onData);
    };
  }, [stdin, setRawMode, step, onChange]);

  return h(
    Boundary,
    null,
    h(
      Node,
      { meta: { role: 'region', name: `${prefix} probe`, testId: 'probe' }, flexDirection: 'column' },
      h(Exploder, { key: 'exploder', boom }),
      h(
        Node,
        { key: 'status', meta: { role: 'status', name: phase, testId: 'phase' } },
        h(Text, null, `phase: ${phase}`),
      ),
      h(
        Node,
        {
          key: 'count',
          meta: { role: 'text', name: `count ${count}`, testId: 'count', value: String(count) },
        },
        h(Text, null, `count: ${count}`),
      ),
      h(
        Node,
        {
          key: 'increment',
          meta: {
            role: 'button',
            name: 'Increment',
            testId: 'increment',
            state: { focused: focus === 'increment' },
          },
        },
        h(Text, null, focus === 'increment' ? '[+]' : ' + '),
      ),
      h(
        Node,
        {
          key: 'decrement',
          meta: {
            role: 'button',
            name: 'Decrement',
            testId: 'decrement',
            state: { focused: focus === 'decrement' },
          },
        },
        h(Text, null, focus === 'decrement' ? '[-]' : ' - '),
      ),
      h(
        Node,
        {
          key: 'size',
          meta: { role: 'text', name: 'size', testId: 'size' },
        },
        h(Text, null, `size: ${stdout.columns}x${stdout.rows}`),
      ),
    ),
  );
}
