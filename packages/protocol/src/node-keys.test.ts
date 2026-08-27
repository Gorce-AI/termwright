import { describe, expect, it } from 'vitest';
import { SEMANTIC_NODE_KEYS, SEMANTIC_STATE_KEYS } from './node-keys.js';
import type { SemanticNode, SemanticState } from './tree.js';

/**
 * Every field of `SemanticNode`, spelled out.
 *
 * `Record<keyof SemanticNode, …>` makes this exhaustive at compile time: add a
 * field to the interface and this object stops compiling until it is listed
 * here, at which point the test below reports whether the schema learned about
 * it too. That is the direction the `keyof` annotation on the exported array
 * cannot catch — it rejects a schema field missing from the interface, not an
 * interface field missing from the schema.
 */
const everyNodeField: Record<keyof SemanticNode, true> = {
  id: true,
  parentId: true,
  role: true,
  name: true,
  description: true,
  value: true,
  geometry: true,
  scroll: true,
  paintedRegion: true,
  state: true,
  extended: true,
  actions: true,
  inputRecipes: true,
  labelledBy: true,
  describedBy: true,
  textRanges: true,
  testId: true,
  frameworkType: true,
  opaqueChildren: true,
  p: true,
  px: true,
};

const everyStateField: Record<keyof SemanticState, true> = {
  disabled: true,
  focused: true,
  selected: true,
  checked: true,
  expanded: true,
  modal: true,
  busy: true,
  hidden: true,
  offscreen: true,
  readonly: true,
  multiline: true,
  required: true,
  multiselectable: true,
  orientation: true,
  level: true,
  positionInSet: true,
  setSize: true,
};

describe('SEMANTIC_NODE_KEYS', () => {
  it('covers every field of the interface, and no more', () => {
    // The failure this guards is not a crash: a field the schema forgot is
    // silently stripped by validation, so a producer emits it and a consumer
    // never sees it. Three fields reached three clients late exactly this way.
    expect([...SEMANTIC_NODE_KEYS].sort()).toEqual(Object.keys(everyNodeField).sort());
  });

  it('includes the fields that went missing before', () => {
    for (const key of ['frameworkType', 'geometry', 'p', 'px'] as const) {
      expect(SEMANTIC_NODE_KEYS).toContain(key);
    }
  });

  it('is frozen, so a consumer cannot corrupt the shared list', () => {
    expect(Object.isFrozen(SEMANTIC_NODE_KEYS)).toBe(true);
  });

  it('has no duplicates', () => {
    expect(new Set(SEMANTIC_NODE_KEYS).size).toBe(SEMANTIC_NODE_KEYS.length);
  });
});

describe('SEMANTIC_STATE_KEYS', () => {
  it('covers every field of the state interface, and no more', () => {
    expect([...SEMANTIC_STATE_KEYS].sort()).toEqual(Object.keys(everyStateField).sort());
  });

  it('is frozen and duplicate-free', () => {
    expect(Object.isFrozen(SEMANTIC_STATE_KEYS)).toBe(true);
    expect(new Set(SEMANTIC_STATE_KEYS).size).toBe(SEMANTIC_STATE_KEYS.length);
  });
});
