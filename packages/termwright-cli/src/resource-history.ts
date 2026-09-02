import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const CACHE_VERSION = 1 as const;
const CACHE_FILE = 'resource-costs-v1.json';
const MAX_CACHE_BYTES = 4 * 1024 * 1024;
const MAX_ENTRIES = 2_048;
const MAX_SAMPLES = 32;

interface CostEntry {
  readonly updatedAt: number;
  readonly durationMs: readonly number[];
  readonly workerPeakRssBytes: readonly number[];
}

export interface ResourceCostEstimate {
  readonly samples: number;
  readonly durationP50Ms: number;
  readonly durationP95Ms: number;
  readonly durationEwmaMs: number;
  readonly workerPeakRssP95Bytes: number;
}

export interface ResourceCostObservation {
  readonly durationMs: number;
  readonly workerPeakRssBytes: number;
}

/** Bounded advisory cache. Corruption yields conservative cache misses, never invented costs. */
export class ResourceCostHistory {
  readonly #directory: string | undefined;
  readonly #entries: Map<string, CostEntry>;
  readonly #now: () => number;

  private constructor(
    directory: string | undefined,
    entries: Map<string, CostEntry>,
    now: () => number,
  ) {
    this.#directory = directory;
    this.#entries = entries;
    this.#now = now;
  }

  static memory(options: { readonly now?: () => number } = {}): ResourceCostHistory {
    return new this(undefined, new Map(), options.now ?? Date.now);
  }

  static async load(
    directory: string,
    options: { readonly now?: () => number } = {},
  ): Promise<ResourceCostHistory> {
    const now = options.now ?? Date.now;
    try {
      const path = join(directory, CACHE_FILE);
      const metadata = await stat(path);
      if (!metadata.isFile() || metadata.size > MAX_CACHE_BYTES)
        return new this(directory, new Map(), now);
      const parsed: unknown = JSON.parse(await readFile(path, 'utf8'));
      return new this(directory, parseCache(parsed), now);
    } catch {
      return new this(directory, new Map(), now);
    }
  }

  static identity(value: {
    readonly project: string;
    readonly file: string;
    readonly fullName: string;
    readonly line?: number;
    readonly column?: number;
  }): string {
    return createHash('sha256')
      .update(
        JSON.stringify([
          value.project,
          value.file.replaceAll('\\', '/'),
          value.fullName,
          value.line ?? null,
          value.column ?? null,
        ]),
      )
      .digest('hex');
  }

  estimate(identity: string): ResourceCostEstimate | undefined {
    const entry = this.#entries.get(identity);
    if (
      entry === undefined ||
      entry.durationMs.length === 0 ||
      entry.workerPeakRssBytes.length === 0
    )
      return undefined;
    return Object.freeze({
      samples: Math.min(entry.durationMs.length, entry.workerPeakRssBytes.length),
      durationP50Ms: quantile(entry.durationMs, 0.5),
      durationP95Ms: quantile(entry.durationMs, 0.95),
      durationEwmaMs: ewma(entry.durationMs),
      workerPeakRssP95Bytes: quantile(entry.workerPeakRssBytes, 0.95),
    });
  }

  observe(identity: string, observation: ResourceCostObservation): void {
    if (!/^[0-9a-f]{64}$/u.test(identity))
      throw new TypeError('resource history identity must be SHA-256');
    if (!metric(observation.durationMs) || !metric(observation.workerPeakRssBytes))
      throw new TypeError('resource history observations must be finite non-negative numbers');
    const previous = this.#entries.get(identity);
    this.#entries.set(identity, {
      updatedAt: this.#now(),
      durationMs: appendSample(previous?.durationMs, observation.durationMs),
      workerPeakRssBytes: appendSample(
        previous?.workerPeakRssBytes,
        observation.workerPeakRssBytes,
      ),
    });
    while (this.#entries.size > MAX_ENTRIES) this.#evictOldest();
  }

  async save(): Promise<void> {
    if (this.#directory === undefined) return;
    await mkdir(this.#directory, { recursive: true, mode: 0o700 });
    const target = join(this.#directory, CACHE_FILE);
    const temporary = join(this.#directory, `.${CACHE_FILE}.${randomUUID()}.tmp`);
    const body = `${JSON.stringify({ v: CACHE_VERSION, entries: Object.fromEntries([...this.#entries].sort(([left], [right]) => left.localeCompare(right))) })}\n`;
    if (Buffer.byteLength(body) > MAX_CACHE_BYTES)
      throw new Error('resource history exceeded its byte ceiling');
    try {
      await writeFile(temporary, body, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
      await rename(temporary, target);
    } finally {
      await rm(temporary, { force: true });
    }
  }

  #evictOldest(): void {
    const oldest = [...this.#entries].sort(
      ([leftId, left], [rightId, right]) =>
        left.updatedAt - right.updatedAt || leftId.localeCompare(rightId),
    )[0];
    if (oldest !== undefined) this.#entries.delete(oldest[0]);
  }
}

function parseCache(value: unknown): Map<string, CostEntry> {
  if (!record(value) || value['v'] !== CACHE_VERSION || !record(value['entries']))
    throw new TypeError('invalid resource history');
  const entries = Object.entries(value['entries']);
  if (entries.length > MAX_ENTRIES) throw new TypeError('resource history has too many entries');
  return new Map(entries.map(([identity, entry]) => [identity, parseEntry(identity, entry)]));
}

function parseEntry(identity: string, value: unknown): CostEntry {
  if (!/^[0-9a-f]{64}$/u.test(identity) || !record(value) || !metric(value['updatedAt']))
    throw new TypeError('invalid resource history entry');
  return {
    updatedAt: value['updatedAt'],
    durationMs: samples(value['durationMs']),
    workerPeakRssBytes: samples(value['workerPeakRssBytes']),
  };
}

function samples(value: unknown): readonly number[] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > MAX_SAMPLES ||
    !value.every(metric)
  )
    throw new TypeError('invalid resource history samples');
  return Object.freeze([...value]);
}

function appendSample(values: readonly number[] | undefined, value: number): readonly number[] {
  return Object.freeze([...(values ?? []), value].slice(-MAX_SAMPLES));
}

function quantile(values: readonly number[], probability: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.ceil(probability * sorted.length) - 1]!;
}

function ewma(values: readonly number[]): number {
  return values.slice(1).reduce((average, value) => 0.25 * value + 0.75 * average, values[0]!);
}

function metric(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= Number.MAX_SAFE_INTEGER
  );
}

function record(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}
