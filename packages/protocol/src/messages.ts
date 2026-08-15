import type { SemanticSnapshot } from './tree.js';
import type { ProtocolLimits } from './limits.js';

/**
 * Wire messages. Transport: length-prefixed JSON frames (see framing.ts).
 * CDP-like: adapter pushes commits; driver issues requests; either side may
 * send errors. All messages are validated against limits BEFORE retention.
 */

export const ADAPTER_CAPABILITIES = [
  'tree',
  'bounds',
  'absolute-bounds',
  'states',
  'actions',
  'text-ranges',
  'render-revisions',
  'tree-diffs',
] as const;
export type AdapterCapability = (typeof ADAPTER_CAPABILITIES)[number];

/** adapter → driver, exactly once, before any other message. */
export interface HelloMessage {
  readonly type: 'hello';
  readonly protocol: 'termwright/1';
  readonly token: string;
  readonly adapter: { readonly name: string; readonly version: string };
  readonly capabilities: readonly AdapterCapability[];
}

/** driver → adapter, reply to hello. */
export interface HelloAckMessage {
  readonly type: 'hello-ack';
  readonly protocol: 'termwright/1';
  readonly sessionId: string;
  readonly limits: ProtocolLimits;
  /** Which traffic the driver wants pushed. v1 drivers request 'snapshots'. */
  readonly subscribe: 'snapshots' | 'revisions';
  /** Marker configuration: adapter must emit DCS marker with this nonce base. */
  readonly marker: { readonly enabled: boolean };
}

/** adapter → driver after each committed render (always, regardless of mode). */
export interface RevisionCommitMessage {
  readonly type: 'revision-commit';
  readonly revision: number;
}

/** adapter → driver, full snapshot for a revision (subscribe: 'snapshots'). */
export interface SnapshotMessage {
  readonly type: 'snapshot';
  readonly snapshot: SemanticSnapshot;
}

/** driver → adapter, request full snapshot (latest, or a held revision). */
export interface GetTreeRequest {
  readonly type: 'get-tree';
  readonly requestId: number;
  readonly revision?: number;
}

/** adapter → driver, response to get-tree. */
export interface GetTreeResponse {
  readonly type: 'get-tree-result';
  readonly requestId: number;
  readonly snapshot?: SemanticSnapshot;
  readonly error?: string;
}

/** either direction: terminal protocol error; sender closes after emitting. */
export interface ProtocolErrorMessage {
  readonly type: 'error';
  readonly code:
    | 'bad-token'
    | 'bad-version'
    | 'malformed'
    | 'limit-exceeded'
    | 'internal';
  readonly message: string;
}

export type AdapterToDriverMessage =
  | HelloMessage
  | RevisionCommitMessage
  | SnapshotMessage
  | GetTreeResponse
  | ProtocolErrorMessage;

export type DriverToAdapterMessage =
  | HelloAckMessage
  | GetTreeRequest
  | ProtocolErrorMessage;
