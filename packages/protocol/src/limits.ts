/**
 * Conservative defaults and absolute maxima. Callers may tighten defaults but
 * can never widen the absolute maxima.
 */
export interface ProtocolLimits {
  readonly maxFrameBytes: number;
  readonly maxSnapshotBytes: number;
  readonly maxNodes: number;
  readonly maxDepth: number;
  readonly maxStringBytes: number;
  readonly maxRelationTargets: number;
  readonly maxQueuedFrames: number;
  readonly maxPendingWaiters: number;
  readonly maxSessions: number;
  /** Byte ceiling for one serialised application log record. */
  readonly maxLogRecordBytes: number;
  /** Log records the driver buffers per session before evicting the oldest. */
  readonly maxLogQueue: number;
}

export const DEFAULT_LIMITS: ProtocolLimits = Object.freeze({
  maxFrameBytes: 1 * 1024 * 1024,
  maxSnapshotBytes: 1 * 1024 * 1024,
  maxNodes: 5_000,
  maxDepth: 64,
  maxStringBytes: 16 * 1024,
  maxRelationTargets: 64,
  maxQueuedFrames: 32,
  maxPendingWaiters: 256,
  maxSessions: 16,
  maxLogRecordBytes: 32 * 1024,
  maxLogQueue: 1_000,
});

export const ABSOLUTE_LIMITS: ProtocolLimits = Object.freeze({
  maxFrameBytes: 8 * 1024 * 1024,
  maxSnapshotBytes: 8 * 1024 * 1024,
  maxNodes: 50_000,
  maxDepth: 256,
  maxStringBytes: 256 * 1024,
  maxRelationTargets: 1_024,
  maxQueuedFrames: 256,
  maxPendingWaiters: 4_096,
  maxSessions: 128,
  maxLogRecordBytes: 256 * 1024,
  maxLogQueue: 10_000,
});

/** Default semantic negotiation window (ms) before a session settles as generic. */
export const DEFAULT_NEGOTIATION_MS = 250;
