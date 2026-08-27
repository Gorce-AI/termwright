/**
 * Semantic roles for the current protocol. ARIA-aligned; closed set. Unknown roles must be rejected
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

export const PHYSICAL_INPUT_RECIPE_ACTIONS = ['focus', 'activate', 'toggle', 'setValue'] as const;
export type PhysicalInputRecipeAction = (typeof PHYSICAL_INPUT_RECIPE_ACTIONS)[number];

/** Data-only physical input recipe; integrations never receive an execution callback. */
export type PhysicalInputRecipeStep =
  { readonly kind: 'press'; readonly key: string } | { readonly kind: 'insert-action-value' };

export interface PhysicalInputRecipe {
  readonly action: PhysicalInputRecipeAction;
  readonly requiresFocus: boolean;
  readonly steps: readonly PhysicalInputRecipeStep[];
}
