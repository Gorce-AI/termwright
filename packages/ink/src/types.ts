import type { RefObject } from 'react';
import type { DOMElement } from 'ink';
import type { SemanticAction, SemanticExtendedState, SemanticRole } from '@termwright/protocol';

/** Intent an application knows and the Ink host tree cannot derive. */
export interface InkSemanticAnnotation {
  readonly role?: SemanticRole;
  /** Accessible name used by `getByRole(role, { name })`. */
  readonly name?: string;
  readonly description?: string;
  readonly testId?: string;
  /** Application-domain JSON; never merged into portable framework state. */
  readonly extended?: SemanticExtendedState;
  /** Descriptive input intent. Actions still travel through the terminal. */
  readonly actions?: readonly SemanticAction[];
  readonly labelledBy?: readonly RefObject<DOMElement | null>[];
  readonly describedBy?: readonly RefObject<DOMElement | null>[];
}

/** @internal Shared, runtime-neutral shape stored behind the global symbol. */
export interface StoredInkAnnotation {
  readonly role?: string;
  readonly name?: string;
  readonly description?: string;
  readonly testId?: string;
  readonly extended?: SemanticExtendedState;
  readonly actions?: readonly SemanticAction[];
  readonly labelledBy?: readonly WeakRef<object>[];
  readonly describedBy?: readonly WeakRef<object>[];
}

/** @internal Stable registry value whose current intent follows React renders. */
export interface InkAnnotationSlot {
  current: StoredInkAnnotation;
}
