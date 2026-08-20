import type {
  SemanticAction,
  SemanticExtendedState,
  SemanticRole,
} from '@termwright/protocol';

/** Any OpenTUI Renderable instance; kept structural to avoid a runtime peer. */
export type OpenTuiRenderable = object;

/** Intent an application knows and the OpenTUI object tree cannot derive. */
export interface OpenTuiSemanticAnnotation {
  readonly role?: SemanticRole;
  readonly name?: string;
  readonly description?: string;
  readonly testId?: string;
  readonly extended?: SemanticExtendedState;
  readonly actions?: readonly SemanticAction[];
  readonly labelledBy?: readonly OpenTuiRenderable[];
  readonly describedBy?: readonly OpenTuiRenderable[];
}

/** @internal Runtime-neutral value behind the shared symbol. */
export interface StoredOpenTuiAnnotation {
  readonly role?: string;
  readonly name?: string;
  readonly description?: string;
  readonly testId?: string;
  readonly extended?: SemanticExtendedState;
  readonly actions?: readonly SemanticAction[];
  readonly labelledBy?: readonly WeakRef<object>[];
  readonly describedBy?: readonly WeakRef<object>[];
}
