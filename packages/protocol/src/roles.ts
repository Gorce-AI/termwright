/**
 * v1 semantic roles. ARIA-aligned; closed set. Unknown roles must be rejected
 * during validation — they never silently acquire behavior.
 */
export const SEMANTIC_ROLES = [
  'application',
  'region',
  'dialog',
  'alert',
  'status',
  'list',
  'listitem',
  'menu',
  'menuitem',
  'button',
  'checkbox',
  'radio',
  'tab',
  'textbox',
  'heading',
  'text',
  'progressbar',
  'separator',
  'scrollbar',
  'table',
  'row',
  'cell',
  'generic',
] as const;

export type SemanticRole = (typeof SEMANTIC_ROLES)[number];

/** Descriptive action capabilities. Diagnostic/strategy hints, never callback endpoints. */
export const SEMANTIC_ACTIONS = [
  'focus',
  'activate',
  'toggle',
  'setValue',
  'scroll',
  'select',
  'expand',
] as const;

export type SemanticAction = (typeof SEMANTIC_ACTIONS)[number];
