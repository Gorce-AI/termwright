/**
 * Exact, content-addressed instrumentation for OpenTUI 0.5.3.
 *
 * Geometry is collected in the renderer's real render-command loop.  The
 * transform deliberately refuses every other input: a best-effort patch here
 * would turn clipping into a guess while still advertising a guarantee.
 */

import { createHash } from 'node:crypto';
import certified from './certified-instrumentation.json' with { type: 'json' };

interface OpenTuiBuildProfile {
  readonly id: string;
  readonly file: string;
  readonly sha256: string;
}

interface OpenTuiInstrumentationProfile {
  readonly version: string;
  readonly builds: readonly OpenTuiBuildProfile[];
}

const BUILTIN_PROFILES: readonly OpenTuiInstrumentationProfile[] = certified.profiles;
export const OPENTUI_VERSION = BUILTIN_PROFILES.at(-1)?.version ?? 'unsupported';
export const FRAME_GEOMETRY_SYMBOL = Symbol.for('termwright.opentui.frame-geometry.v1');
export const INSTRUMENTATION_SENTINEL = Symbol.for('termwright.opentui.instrumentation.v1');

export const OPENTUI_CHUNK_PATTERN = /@opentui[\\/]core[\\/](chunk-(?:node|bun)-[A-Za-z0-9_-]+\.js)$/u;

export interface InstrumentedRect {
  readonly row: number;
  readonly column: number;
  readonly width: number;
  readonly height: number;
}

export interface CommittedFrameGeometry {
  readonly frameId: number;
  readonly columns: number;
  readonly rows: number;
  readonly surfaceColumns: number;
  readonly surfaceRows: number;
  readonly surfaceOrigin: { readonly row: number; readonly column: number };
  readonly intended: ReadonlyMap<string, InstrumentedRect>;
  readonly visible: ReadonlyMap<string, InstrumentedRect>;
}

export interface FrameGeometryProvider {
  readonly version: 1;
  readonly frameworkVersion: string;
  getCommitted(frameId: number): CommittedFrameGeometry | undefined;
}

export interface InstrumentationSentinel {
  readonly version: 1;
  readonly frameworkVersion: string;
  readonly build: string;
  readonly checksum: string;
}

export function instrumentationSentinel(): InstrumentationSentinel | undefined {
  const value = (globalThis as Record<PropertyKey, unknown>)[INSTRUMENTATION_SENTINEL];
  if (value === null || typeof value !== 'object') return undefined;
  const candidate = value as Partial<InstrumentationSentinel>;
  if (candidate.version !== 1) return undefined;
  const profile = instrumentationProfiles().find((entry) => entry.version === candidate.frameworkVersion);
  const build = profile?.builds.find((entry) => entry.id === candidate.build);
  if (build === undefined || candidate.checksum !== build.sha256) return undefined;
  return candidate as InstrumentationSentinel;
}

export function geometryProvider(renderer: object): FrameGeometryProvider | undefined {
  const value = (renderer as Record<PropertyKey, unknown>)[FRAME_GEOMETRY_SYMBOL];
  if (value === null || typeof value !== 'object') return undefined;
  const provider = value as Partial<FrameGeometryProvider>;
  // Bootstrap validates the checksum-bound sentinel before it constructs a
  // session. At the session boundary validate the provider's own immutable
  // version against the same frozen profile set; requiring the process-global
  // sentinel here would make the otherwise pure session API untestable and
  // would couple every committed-frame read to mutable global state.
  const certifiedVersion = instrumentationProfiles()
    .find((entry) => entry.version === provider.frameworkVersion)
    ?.version;
  return provider.version === 1
    && certifiedVersion !== undefined
    && provider.frameworkVersion === certifiedVersion
    && typeof provider.getCommitted === 'function'
    ? provider as FrameGeometryProvider
    : undefined;
}

/** Transform only an exact certified upstream artifact. */
export function instrumentOpenTuiChunk(path: string, source: string): string | undefined {
  const match = OPENTUI_CHUNK_PATTERN.exec(path.split('?')[0] ?? '');
  if (match === null) return undefined;
  const file = match[1];
  const checksum = createHash('sha256').update(source).digest('hex');
  const matched = instrumentationProfiles()
    .flatMap((profile) => profile.builds.map((build) => ({ profile, build })))
    .find((entry) => entry.build.file === file && entry.build.sha256 === checksum);
  if (matched === undefined) return undefined;
  const { profile, build } = matched;

  const rootStart = `  render(buffer, deltaTime) {\n    this._currentRenderable = undefined;\n    if (!this.visible)\n      return;`;
  const rootStartReplacement = `  render(buffer, deltaTime) {\n    this._currentRenderable = undefined;\n    __termwrightGeometryBegin(this._ctx, this);\n    if (!this.visible)\n      return;`;
  const renderCommand = `            this._currentRenderable = command.renderable;\n            command.renderable.render(buffer, deltaTime);\n            this._currentRenderable = undefined;`;
  const renderCommandReplacement = `            this._currentRenderable = command.renderable;\n            command.renderable.render(buffer, deltaTime);\n            __termwrightGeometryRecord(this._ctx, command.renderable);\n            this._currentRenderable = undefined;`;
  const pushCommand = `          this._ctx.pushHitGridScissorRect(command.screenX, command.screenY, command.width, command.height);`;
  const pushCommandReplacement = `${pushCommand}\n          __termwrightGeometryPush(this._ctx, command.x, command.y, command.width, command.height);`;
  const popCommand = `          this._ctx.popHitGridScissorRect();`;
  const popCommandReplacement = `${popCommand}\n          __termwrightGeometryPop(this._ctx);`;
  const rootEnd = `      }\n    }\n  }\n  propagateLiveCount(delta) {`;
  const rootEndReplacement = `      }\n    }\n    __termwrightGeometryComplete(this._ctx, this);\n  }\n  propagateLiveCount(delta) {`;
  const commitPoint = `        if (nativeStatus === "rendered") {\n          if (this._useMouse`;
  const commitReplacement = `        if (nativeStatus === "rendered") {\n          __termwrightGeometryCommit(this);\n          if (this._useMouse`;

  let output = source;
  for (const [needle, replacement] of [
    [rootStart, rootStartReplacement],
    [renderCommand, renderCommandReplacement],
    [pushCommand, pushCommandReplacement],
    [popCommand, popCommandReplacement],
    [rootEnd, rootEndReplacement],
    [commitPoint, commitReplacement],
  ] as const) {
    if (output.split(needle).length !== 2) return undefined;
    output = output.replace(needle, replacement);
  }

  const insertionPoint = '// src/Renderable.ts\nvar BrandedRenderable';
  if (output.split(insertionPoint).length !== 2) return undefined;
  const helpers = geometryRuntime(profile.version, build.id, checksum);
  return output.replace(insertionPoint, `${helpers}\n${insertionPoint}`);
}

function geometryRuntime(frameworkVersion: string, build: string, checksum: string): string {
  return `const __termwrightGeometrySymbol = Symbol.for("termwright.opentui.frame-geometry.v1");
const __termwrightInstrumentationSymbol = Symbol.for("termwright.opentui.instrumentation.v1");
globalThis[__termwrightInstrumentationSymbol] = Object.freeze({ version: 1, frameworkVersion: "${frameworkVersion}", build: "${build}", checksum: "${checksum}" });
function __termwrightRect(x, y, width, height) {
  const left = Number.isFinite(x) ? x : 0;
  const top = Number.isFinite(y) ? y : 0;
  const right = Number.isFinite(width) ? left + Math.max(0, width) : left;
  const bottom = Number.isFinite(height) ? top + Math.max(0, height) : top;
  return { left, top, right, bottom };
}
function __termwrightIntersection(a, b) {
  const left = Math.max(a.left, b.left);
  const top = Math.max(a.top, b.top);
  const right = Math.max(left, Math.min(a.right, b.right));
  const bottom = Math.max(top, Math.min(a.bottom, b.bottom));
  return { left, top, right, bottom };
}
function __termwrightPublicRect(rect, originRow) {
  return Object.freeze({ row: rect.top + originRow, column: rect.left, width: rect.right - rect.left, height: rect.bottom - rect.top });
}
function __termwrightGeometryState(ctx) {
  let state = ctx[__termwrightGeometrySymbol];
  if (state === undefined) {
    state = { version: 1, frameworkVersion: "${frameworkVersion}", pending: undefined, committed: undefined, getCommitted(frameId) { return this.committed?.frameId === frameId ? this.committed : undefined; } };
    Object.defineProperty(ctx, __termwrightGeometrySymbol, { value: state, enumerable: false, configurable: false });
  }
  return state;
}
function __termwrightGeometryBegin(ctx, root) {
  const state = __termwrightGeometryState(ctx);
  const columns = Math.max(0, ctx.terminalWidth ?? ctx.width ?? 0);
  const rows = Math.max(0, ctx.terminalHeight ?? ctx.height ?? 0);
  const surfaceColumns = Math.max(0, ctx.width ?? 0);
  const surfaceRows = Math.max(0, ctx.height ?? 0);
  const originRow = Number.isFinite(ctx.renderOffset) ? ctx.renderOffset : 0;
  state.pending = { frameId: ctx.frameId, columns, rows, surfaceColumns, surfaceRows, originRow, clipStack: [__termwrightRect(0, 0, surfaceColumns, surfaceRows)], intended: new Map(), visible: new Map() };
}
function __termwrightGeometryRecord(ctx, renderable) {
  const pending = __termwrightGeometryState(ctx).pending;
  if (pending === undefined || pending.frameId !== ctx.frameId || renderable?.num === undefined) return;
  const intended = __termwrightRect(renderable.screenX, renderable.screenY, renderable.width, renderable.height);
  const clip = pending.clipStack[pending.clipStack.length - 1];
  const visible = __termwrightIntersection(intended, clip);
  const key = String(renderable.num);
  pending.intended.set(key, __termwrightPublicRect(intended, pending.originRow));
  pending.visible.set(key, __termwrightPublicRect(visible, pending.originRow));
}
function __termwrightGeometryPush(ctx, x, y, width, height) {
  const pending = __termwrightGeometryState(ctx).pending;
  if (pending === undefined || pending.frameId !== ctx.frameId) return;
  pending.clipStack.push(__termwrightIntersection(pending.clipStack[pending.clipStack.length - 1], __termwrightRect(x, y, width, height)));
}
function __termwrightGeometryPop(ctx) {
  const pending = __termwrightGeometryState(ctx).pending;
  if (pending !== undefined && pending.frameId === ctx.frameId && pending.clipStack.length > 1) pending.clipStack.pop();
}
function __termwrightGeometryComplete(ctx, root) {
  const pending = __termwrightGeometryState(ctx).pending;
  if (pending === undefined || pending.frameId !== ctx.frameId) return;
  __termwrightGeometryRecord(ctx, root);
  const visit = (node, displayed) => {
    const isDisplayed = displayed && node.visible !== false;
    if (isDisplayed && !pending.visible.has(String(node.num))) {
      const intended = __termwrightRect(node.screenX, node.screenY, node.width, node.height);
      pending.intended.set(String(node.num), __termwrightPublicRect(intended, pending.originRow));
      pending.visible.set(String(node.num), Object.freeze({ row: Math.min(Math.max(intended.top + pending.originRow, 0), pending.rows), column: Math.min(Math.max(intended.left, 0), pending.columns), width: 0, height: 0 }));
    }
    for (const child of node.getChildren?.() ?? []) visit(child, isDisplayed);
  };
  visit(root, true);
}
function __termwrightGeometryCommit(ctx) {
  const state = __termwrightGeometryState(ctx);
  const pending = state.pending;
  if (pending === undefined || pending.frameId !== ctx.frameId) return;
  state.committed = Object.freeze({ frameId: pending.frameId, columns: pending.columns, rows: pending.rows, surfaceColumns: pending.surfaceColumns, surfaceRows: pending.surfaceRows, surfaceOrigin: Object.freeze({ row: pending.originRow, column: 0 }), intended: new Map(pending.intended), visible: new Map(pending.visible) });
  state.pending = undefined;
}`;
}

function instrumentationProfiles(): readonly OpenTuiInstrumentationProfile[] {
  const override = certificationOverride();
  return override === undefined ? BUILTIN_PROFILES : [override, ...BUILTIN_PROFILES];
}

function certificationOverride(): OpenTuiInstrumentationProfile | undefined {
  const raw = process.env['TERMWRIGHT_CERTIFICATION_HOOK_PROFILE'];
  if (raw === undefined || process.env['GITHUB_ACTIONS'] !== 'true') return undefined;
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    const digest = process.env['TERMWRIGHT_CERTIFICATION_CANDIDATE_DIGEST'];
    const revision = process.env['TERMWRIGHT_CERTIFICATION_SOURCE_REVISION'];
    if (
      value['framework'] !== 'opentui'
      || !/^sha256:[a-f0-9]{64}$/u.test(digest ?? '')
      || revision !== process.env['GITHUB_SHA']
      || value['sourceRevision'] !== revision
      || value['candidateDigest'] !== digest
      || typeof value['version'] !== 'string'
      || !Array.isArray(value['builds'])
    ) return undefined;
    const builds: OpenTuiBuildProfile[] = [];
    for (const rawBuild of value['builds']) {
      if (rawBuild === null || typeof rawBuild !== 'object') return undefined;
      const candidate = rawBuild as Record<string, unknown>;
      if (
        typeof candidate['id'] !== 'string'
        || typeof candidate['file'] !== 'string'
        || !/^chunk-(?:node|bun)-[A-Za-z0-9_-]+\.js$/u.test(candidate['file'])
        || !/^[a-f0-9]{64}$/u.test(String(candidate['sha256']))
      ) return undefined;
      builds.push({ id: candidate['id'], file: candidate['file'], sha256: String(candidate['sha256']) });
    }
    if (builds.length !== 2 || new Set(builds.map((entry) => entry.file)).size !== builds.length) return undefined;
    return { version: value['version'], builds };
  } catch {
    return undefined;
  }
}
