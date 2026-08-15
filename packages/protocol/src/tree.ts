import type { SemanticAction, SemanticRole } from './roles.js';

/** Zero-based viewport cell coordinates. */
export interface Rect {
  readonly row: number;
  readonly column: number;
  readonly width: number;
  readonly height: number;
}

/** Closed state set. No arbitrary records. */
export interface SemanticState {
  readonly disabled?: boolean;
  readonly focused?: boolean;
  readonly selected?: boolean;
  readonly checked?: boolean | 'mixed';
  readonly expanded?: boolean;
  readonly modal?: boolean;
  readonly busy?: boolean;
  readonly hidden?: boolean;
  readonly readonly?: boolean;
  readonly multiline?: boolean;
  readonly orientation?: 'horizontal' | 'vertical';
  readonly level?: number;
  readonly positionInSet?: number;
  readonly setSize?: number;
  readonly scrollOffset?: number;
  readonly scrollExtent?: number;
}

/** Maps grapheme offsets of a node's text to cell coordinates (optional capability). */
export interface SemanticTextRange {
  readonly startOffset: number;
  readonly endOffset: number;
  readonly rect: Rect;
}

export interface SemanticNode {
  readonly id: string;
  readonly parentId?: string;
  readonly role: SemanticRole;
  readonly name: string;
  readonly description?: string;
  readonly value?: string;
  /** Optional: class-B/C frameworks publish nodes without trustworthy bounds. */
  readonly bounds?: Rect;
  readonly state?: SemanticState;
  readonly actions?: readonly SemanticAction[];
  readonly labelledBy?: readonly string[];
  readonly describedBy?: readonly string[];
  readonly textRanges?: readonly SemanticTextRange[];
  /** Author-supplied test id (getByTestId). */
  readonly testId?: string;
}

export interface CursorInfo {
  readonly row: number;
  readonly column: number;
  readonly visible: boolean;
  readonly shape?: 'block' | 'underline' | 'bar';
}

export interface SemanticSnapshot {
  readonly v: 1;
  readonly sessionId: string;
  /** Positive, strictly increasing within a semantic session. */
  readonly revision: number;
  readonly columns: number;
  readonly rows: number;
  readonly cursor?: CursorInfo;
  readonly rootIds: readonly string[];
  readonly nodes: readonly SemanticNode[];
}
