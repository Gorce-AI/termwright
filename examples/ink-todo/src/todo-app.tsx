/**
 * A small todo list: a filter box, a list, two buttons and a modal
 * confirmation before anything is removed.
 *
 * Every widget a test needs to address is annotated with `useSemantic`. Those
 * annotations are the whole instrumentation — no test hooks, no exported
 * callbacks, no `if (process.env.NODE_ENV === 'test')`.
 */

import { useEffect, useRef, useState } from 'react';
import { Box, Text, useInput, type DOMElement } from 'ink';
import { useSemantic } from '@termwright/ink';
import { ConfirmDialog } from './confirm-dialog.js';
import { hits, isMouseReport, parseMousePress, useMouseReporting } from './mouse.js';
import { SEED_TODOS, type Todo } from './store.js';

export interface TodoAppProps {
  /** Where the list starts. Defaults to the seed, as a first run would. */
  readonly todos?: readonly Todo[];
  /** Called with the whole list whenever it changes, for the caller to persist. */
  readonly onTodosChange?: (todos: readonly Todo[]) => void;
}

type Focus = 'filter' | 'list' | 'add' | 'remove';
/** Where Tab goes from each widget. Total, so the ring needs no bounds check. */
const NEXT_FOCUS: Record<Focus, Focus> = {
  filter: 'list',
  list: 'add',
  add: 'remove',
  remove: 'filter',
};

export function TodoApp({ todos: initial = SEED_TODOS, onTodosChange }: TodoAppProps = {}) {
  const filterRef = useRef<DOMElement>(null);
  const listRef = useRef<DOMElement>(null);
  const addRef = useRef<DOMElement>(null);
  const removeRef = useRef<DOMElement>(null);

  const [todos, setTodos] = useState<readonly Todo[]>(initial);
  const [filter, setFilter] = useState('');
  const [focus, setFocus] = useState<Focus>('filter');
  const [selected, setSelected] = useState(0);
  const [confirming, setConfirming] = useState(false);
  const [status, setStatus] = useState('ready');

  const visible = todos.filter((todo) => todo.text.includes(filter));
  const current = visible[Math.min(selected, visible.length - 1)];

  useMouseReporting();

  // Persist on change, not on mount: a run that only looks at the list must
  // leave the file exactly as it found it.
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    onTodosChange?.(todos);
  }, [todos, onTodosChange]);

  useSemantic(filterRef, {
    role: 'textbox',
    name: 'Filter',
    value: filter,
    state: { focused: focus === 'filter' },
    testId: 'filter',
  });
  useSemantic(listRef, {
    role: 'list',
    name: 'Todos',
    state: { focused: focus === 'list', orientation: 'vertical', setSize: visible.length },
    testId: 'todos',
  });
  useSemantic(addRef, {
    role: 'button',
    name: 'Add',
    // The filter box doubles as the new-todo field, so with nothing typed
    // there is nothing to add and the button says so.
    state: { focused: focus === 'add', disabled: filter.length === 0 },
    testId: 'add',
  });
  useSemantic(removeRef, {
    role: 'button',
    name: 'Remove',
    state: { focused: focus === 'remove', disabled: current === undefined },
    testId: 'remove',
  });

  function add(): void {
    if (filter.length === 0) return;
    setTodos((all) => [...all, { id: Math.max(0, ...all.map((t) => t.id)) + 1, text: filter, done: false }]);
    setStatus(`added ${filter}`);
    setFilter('');
  }

  function remove(todo: Todo): void {
    setTodos((all) => all.filter((other) => other.id !== todo.id));
    setSelected(0);
    setStatus(`removed ${todo.text}`);
  }

  function activate(target: Focus): void {
    if (target === 'add') add();
    else if (target === 'remove' && current !== undefined) setConfirming(true);
  }

  // While the dialog is up it owns the keyboard and the mouse; a modal that
  // lets the screen behind it keep reacting is not modal.
  useInput(
    (input, key) => {
      // Every mouse report returns early, not just the press this handler
      // acts on: letting a release fall through types "[<0;36;2m" into the
      // filter box.
      if (isMouseReport(input)) {
        const point = parseMousePress(input);
        if (point === null) return;
        if (hits(filterRef.current, point)) setFocus('filter');
        else if (hits(listRef.current, point)) setFocus('list');
        else if (hits(addRef.current, point)) {
          setFocus('add');
          activate('add');
        } else if (hits(removeRef.current, point)) {
          setFocus('remove');
          activate('remove');
        }
        return;
      }

      if (key.tab) {
        setFocus((from) => NEXT_FOCUS[from]);
        return;
      }
      if (key.return) {
        activate(focus);
        return;
      }
      if (key.upArrow || key.downArrow) {
        const delta = key.upArrow ? -1 : 1;
        setFocus('list');
        setSelected((index) => Math.min(visible.length - 1, Math.max(0, index + delta)));
        return;
      }
      if (input === ' ' && focus === 'list' && current !== undefined) {
        setTodos((all) => all.map((todo) => (todo.id === current.id ? { ...todo, done: !todo.done } : todo)));
        return;
      }
      if (focus === 'filter') {
        if (key.backspace || key.delete) setFilter((text) => text.slice(0, -1));
        else if (input.length > 0 && !key.ctrl && !key.meta && !key.escape) setFilter((text) => text + input);
      }
    },
    { isActive: !confirming },
  );

  return (
    <Box flexDirection="column">
      <Text bold>Termwright Todo</Text>

      <Box ref={filterRef}>
        <Text>{`Filter: ${filter}${focus === 'filter' ? '_' : ' '}`}</Text>
      </Box>

      <Box ref={listRef} flexDirection="column">
        {visible.map((todo, index) => (
          <TodoRow
            key={todo.id}
            todo={todo}
            index={index}
            total={visible.length}
            selected={current?.id === todo.id}
          />
        ))}
      </Box>

      <Box>
        <Box ref={addRef} paddingRight={1}>
          <Text inverse={focus === 'add'} dimColor={filter.length === 0}>
            {' Add '}
          </Text>
        </Box>
        <Box ref={removeRef}>
          <Text inverse={focus === 'remove'} dimColor={current === undefined}>
            {' Remove '}
          </Text>
        </Box>
      </Box>

      <Text>{`status: ${status}`}</Text>

      {confirming && current !== undefined ? (
        <ConfirmDialog
          title={`Remove "${current.text}"?`}
          onConfirm={() => {
            setConfirming(false);
            remove(current);
          }}
          onCancel={() => {
            setConfirming(false);
            setStatus('cancelled');
          }}
        />
      ) : null}
    </Box>
  );
}

function TodoRow({
  todo,
  index,
  total,
  selected,
}: {
  readonly todo: Todo;
  readonly index: number;
  readonly total: number;
  readonly selected: boolean;
}) {
  const ref = useRef<DOMElement>(null);

  useSemantic(ref, {
    role: 'listitem',
    name: todo.text,
    state: { selected, checked: todo.done, positionInSet: index + 1, setSize: total },
    testId: `todo-${todo.id}`,
  });

  return (
    <Box ref={ref}>
      <Text>{`${selected ? '>' : ' '} [${todo.done ? 'x' : ' '}] ${todo.text}`}</Text>
    </Box>
  );
}
