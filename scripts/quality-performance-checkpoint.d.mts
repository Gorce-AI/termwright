export declare const CHECKPOINT_DIRECTORY_ENV: 'TERMWRIGHT_QUALITY_CHECKPOINT_DIR';
export declare const CHECKPOINT_NONCE_ENV: 'TERMWRIGHT_QUALITY_CHECKPOINT_NONCE';
export declare const CHECKPOINT_SCHEMA_VERSION: 1;

export interface QualityCheckpoint {
  readonly directory: string;
  readonly nonce: string;
  readonly expectedSessions: number;
}

export type QualityCheckpointTerminal =
  | Readonly<{
      kind: 'termwright-quality-snapshot-terminal';
      schemaVersion: 1;
      nonce: string;
      status: 'ok';
      sessions: number;
      processCount: number;
    }>
  | Readonly<{
      kind: 'termwright-quality-snapshot-terminal';
      schemaVersion: 1;
      nonce: string;
      status: 'failure';
      message: string;
    }>;

export interface QualityCheckpointReady {
  readonly kind: 'termwright-quality-snapshot-ready';
  readonly schemaVersion: 1;
  readonly nonce: string;
  readonly processPids: readonly number[];
}

export declare function createQualityCheckpoint(
  expectedSessions: number,
): Promise<QualityCheckpoint>;
export declare function qualityCheckpointEnvironment(
  checkpoint: QualityCheckpoint,
): Readonly<Record<string, string>>;
export declare function qualityCheckpointIsConfigured(
  env?: Readonly<Record<string, string | undefined>>,
): boolean;
export declare function readQualityCheckpointFromEnvironment(
  env?: Readonly<Record<string, string | undefined>>,
): Promise<QualityCheckpoint>;
export declare function publishQualityReady(
  checkpoint: QualityCheckpoint,
  processPids: readonly number[],
): Promise<void>;
export declare function waitForQualityReady(
  checkpoint: QualityCheckpoint,
  options?: Readonly<{ signal?: AbortSignal }>,
): Promise<QualityCheckpointReady>;
export declare function publishQualityTerminal(
  checkpoint: QualityCheckpoint,
  outcome:
    | Readonly<{ status: 'ok'; processCount: number }>
    | Readonly<{ status: 'failure'; message: string }>,
): Promise<void>;
export declare function waitForQualityTerminal(
  checkpoint: QualityCheckpoint,
  options?: Readonly<{ signal?: AbortSignal }>,
): Promise<QualityCheckpointTerminal>;
