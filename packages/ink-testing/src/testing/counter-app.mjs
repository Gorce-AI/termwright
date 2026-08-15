/**
 * The component both modes are tested against.
 *
 * Plain JavaScript with `createElement` calls rather than JSX, because the very
 * same file is imported twice: once by the in-process tests, and once by a
 * fixture process running under a bare `node` with no build step. Parity
 * between `mountInk` and `launchInkFixture` is only worth asserting if both
 * render literally the same code.
 *
 * It is a deliberately physical component: it enables SGR mouse reporting, hit
 * tests real mouse reports against its own measured bounds, and moves focus on
 * Tab. Nothing here knows that a test exists.
 */

import { createElement, useCallback, useEffect, useRef, useState } from 'react';
import { Box, Text, measureElement, useInput, useStdout } from 'ink';
import { useSemantic } from '@termwright/ink';

/**
 * SGR mouse report, as Ink hands it to `useInput`: the leading ESC has already
 * been stripped from sequences its key parser did not recognise.
 */
const SGR_MOUSE = /\u001B?\[<(\d+);(\d+);(\d+)([Mm])/u;

/** Left-button press coordinates (zero-based), or null. */
function parseMousePress(input) {
  const match = SGR_MOUSE.exec(input);
  if (match === null) return null;
  if (match[4] !== 'M') return null; // release
  if (Number(match[1]) !== 0) return null; // not the left button
  return { column: Number(match[2]) - 1, row: Number(match[3]) - 1 };
}

function contains(metrics, point) {
  return (
    point.column >= metrics.x &&
    point.column < metrics.x + metrics.width &&
    point.row >= metrics.y &&
    point.row < metrics.y + metrics.height
  );
}

/**
 * @param {{label?: string, greeting?: string, onPress?: () => void}} props
 */
export default function CounterApp({ label = 'Approve', greeting = 'ready', onPress }) {
  const buttonRef = useRef(null);
  const inputRef = useRef(null);
  const [pressed, setPressed] = useState(0);
  const [message, setMessage] = useState('');
  const [focus, setFocus] = useState('button');
  const { stdout } = useStdout();

  // Mouse reporting is opt-in for the application, exactly as in a real TUI:
  // a driver that finds it disabled refuses to click rather than inventing input.
  useEffect(() => {
    stdout.write('\u001B[?1000h\u001B[?1006h');
    return () => {
      stdout.write('\u001B[?1006l\u001B[?1000l');
    };
  }, [stdout]);

  useSemantic(buttonRef, {
    role: 'button',
    name: label,
    testId: 'action',
    state: { focused: focus === 'button' },
  });

  useSemantic(inputRef, {
    role: 'textbox',
    name: 'Message',
    value: message,
    testId: 'message',
    state: { focused: focus === 'input' },
  });

  const press = useCallback(() => {
    setPressed((count) => count + 1);
    if (onPress !== undefined) onPress();
  }, [onPress]);

  useInput((input, key) => {
    const point = parseMousePress(input);
    if (point !== null) {
      if (buttonRef.current !== null && contains(measureElement(buttonRef.current), point)) {
        setFocus('button');
        press();
      } else if (inputRef.current !== null && contains(measureElement(inputRef.current), point)) {
        setFocus('input');
      }
      return;
    }

    if (key.tab) {
      setFocus((current) => (current === 'button' ? 'input' : 'button'));
      return;
    }

    if (focus === 'button') {
      if (key.return) press();
      return;
    }

    if (key.backspace || key.delete) {
      setMessage((current) => current.slice(0, -1));
      return;
    }
    if (input.length > 0 && !key.ctrl && !key.meta && !key.escape) {
      setMessage((current) => current + input);
    }
  });

  return createElement(
    Box,
    { flexDirection: 'column' },
    createElement(Text, null, greeting),
    createElement(
      Box,
      { ref: buttonRef, borderStyle: 'round', paddingX: 1 },
      createElement(Text, null, label),
    ),
    createElement(Box, { ref: inputRef }, createElement(Text, null, `> ${message}`)),
    createElement(Text, null, `pressed ${pressed}`),
  );
}
