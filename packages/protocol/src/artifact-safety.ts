import type { SemanticSnapshot } from './tree.js';

/** Policy applied when runtime values cross an artifact/publication boundary. */
export const ARTIFACT_VALUE_POLICIES = ['none', 'redacted', 'raw'] as const;
export type ArtifactValuePolicy = (typeof ARTIFACT_VALUE_POLICIES)[number];

/** Secure default. Recording raw input must always be an explicit choice. */
export const DEFAULT_ARTIFACT_VALUE_POLICY: ArtifactValuePolicy = 'redacted';

export interface ArtifactRedactionPattern {
  readonly pattern: RegExp;
  /** Explicit streaming look-behind bound; matches exceeding it fail secure. */
  readonly maxMatchChars: number;
}

/** One policy shared by every durable or externally published artifact sink. */
export interface ArtifactSecurityPolicy {
  readonly mode: ArtifactValuePolicy;
  /** Exact values Termwright is authorized to treat as secrets. */
  readonly secrets?: readonly string[];
  /** Recognizable credential forms; automatic discovery is intentionally not promised. */
  readonly patterns?: readonly ArtifactRedactionPattern[];
  /** Maximum raw control bytes retained while matching split terminal text. */
  readonly maxTerminalPendingBytes?: number;
}

export interface ResolvedArtifactSecurityPolicy {
  readonly mode: ArtifactValuePolicy;
  readonly secrets: readonly string[];
  readonly patterns: readonly ArtifactRedactionPattern[];
  readonly maxTerminalPendingBytes: number;
}

export const DEFAULT_ARTIFACT_SECURITY_POLICY: ResolvedArtifactSecurityPolicy = Object.freeze({
  mode: 'redacted',
  secrets: Object.freeze([]),
  patterns: Object.freeze([]),
  maxTerminalPendingBytes: 256 * 1024,
});

export function resolveArtifactSecurityPolicy(
  policy: ArtifactSecurityPolicy | undefined,
): ResolvedArtifactSecurityPolicy {
  if (policy === undefined) return DEFAULT_ARTIFACT_SECURITY_POLICY;
  if (!ARTIFACT_VALUE_POLICIES.includes(policy.mode)) {
    throw new TypeError(`unknown artifact security mode ${String(policy.mode)}`);
  }
  const secrets = [...new Set((policy.secrets ?? []).filter((value) => value.length > 0))];
  const maxTerminalPendingBytes =
    policy.maxTerminalPendingBytes ?? DEFAULT_ARTIFACT_SECURITY_POLICY.maxTerminalPendingBytes;
  if (!Number.isSafeInteger(maxTerminalPendingBytes) || maxTerminalPendingBytes < 1024) {
    throw new TypeError('artifact security maxTerminalPendingBytes must be an integer >= 1024');
  }
  const patterns = (policy.patterns ?? []).map(({ pattern, maxMatchChars }) => {
    if (!(pattern instanceof RegExp))
      throw new TypeError('artifact redaction pattern must be RegExp');
    if (!Number.isSafeInteger(maxMatchChars) || maxMatchChars < 1) {
      throw new TypeError('artifact redaction maxMatchChars must be a positive integer');
    }
    return Object.freeze({ pattern: new RegExp(pattern.source, pattern.flags), maxMatchChars });
  });
  return Object.freeze({
    mode: policy.mode,
    secrets: Object.freeze(secrets),
    patterns: Object.freeze(patterns),
    maxTerminalPendingBytes,
  });
}

export type ValueSensitivity = 'public' | 'sensitive';

/** Explicit wrapper for values which must not enter artifacts by default. */
export interface SensitiveValue {
  readonly sensitivity: 'sensitive';
  readonly value: string;
}

export interface PublicValue {
  readonly sensitivity: 'public';
  readonly value: string;
}
/** Plain strings remain executable but are conservatively sensitive at artifact boundaries. */
export type ExecutableValue = string | PublicValue | SensitiveValue;

export type RecordedValue =
  | { readonly status: 'known'; readonly value: string; readonly sensitivity: ValueSensitivity }
  | {
      readonly status: 'withheld';
      readonly reason: 'artifact-policy';
      readonly sensitivity: ValueSensitivity | 'unknown';
    };

export function sensitive(value: string): SensitiveValue {
  return Object.freeze({ sensitivity: 'sensitive', value });
}

export function publicValue(value: string): PublicValue {
  return Object.freeze({ sensitivity: 'public', value });
}

export function executableText(value: ExecutableValue): string {
  return typeof value === 'string' ? value : value.value;
}

export function valueSensitivity(value: ExecutableValue): ValueSensitivity {
  return typeof value === 'string' ? 'sensitive' : value.sensitivity;
}

export function recordValue(value: ExecutableValue, policy: ArtifactValuePolicy): RecordedValue {
  const sensitivity = valueSensitivity(value);
  if (policy === 'raw' || (policy === 'redacted' && sensitivity === 'public')) {
    return Object.freeze({ status: 'known', value: executableText(value), sensitivity });
  }
  return Object.freeze({ status: 'withheld', reason: 'artifact-policy', sensitivity });
}

export function projectSemanticSnapshotForArtifact(
  snapshot: SemanticSnapshot,
  policy: ArtifactValuePolicy = DEFAULT_ARTIFACT_VALUE_POLICY,
): SemanticSnapshot {
  return Object.freeze({
    ...snapshot,
    nodes: Object.freeze(
      snapshot.nodes.map((node) => {
        const value = node.value;
        if (
          value?.status !== 'known' ||
          policy === 'raw' ||
          (policy === 'redacted' && value.sensitivity === 'public')
        ) {
          return Object.freeze({ ...node });
        }
        return Object.freeze({
          ...node,
          value: Object.freeze({
            status: 'withheld' as const,
            reason: 'artifact-policy' as const,
            sensitivity: value.sensitivity,
          }),
        });
      }),
    ),
  });
}
