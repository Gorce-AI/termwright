/** Exact, content-addressed instrumentation for Ink 7.1.1's renderer. */

import { createHash } from 'node:crypto';
import certified from './certified-instrumentation.json' with { type: 'json' };

interface InkInstrumentationProfile {
  readonly version: string;
  readonly rendererSha256: string;
  readonly coreSha256: string;
}

const BUILTIN_PROFILES: readonly InkInstrumentationProfile[] = certified.profiles;
export const INK_VERSION = BUILTIN_PROFILES.at(-1)?.version ?? 'unsupported';
export const INK_RENDER_CAPTURE = Symbol.for('termwright.ink.render-capture.v1');
export const INK_FRAME_CONTEXT = Symbol.for('termwright.ink.frame-context.v1');
export const INK_INSTRUMENTATION_SENTINEL = Symbol.for('termwright.ink.instrumentation.v1');

export const INK_RENDERER_PATTERN = /[\\/](?:ink|ink@[^\\/]+)[\\/]build[\\/]renderer\.js$/u;
export const INK_CORE_PATTERN = /[\\/](?:ink|ink@[^\\/]+)[\\/]build[\\/]ink\.js$/u;

export interface InkInstrumentationSentinel {
  readonly version: 1;
  readonly frameworkVersion: string;
  readonly rendererChecksum: string;
  readonly coreChecksum: string;
}

export interface InkRenderedOutput {
  readonly output: string;
  readonly outputHeight: number;
  readonly staticOutput: string;
}

export type InkRenderCaptureHook = (
  root: object,
  result: InkRenderedOutput,
  screenReader: boolean,
) => void;

export function instrumentationSentinel(): InkInstrumentationSentinel | undefined {
  const value = (globalThis as Record<PropertyKey, unknown>)[INK_INSTRUMENTATION_SENTINEL];
  if (value === null || typeof value !== 'object') return undefined;
  const candidate = value as Partial<InkInstrumentationSentinel>;
  const profile = instrumentationProfiles().find(
    (entry) => entry.version === candidate.frameworkVersion,
  );
  return profile !== undefined &&
    candidate.version === 1 &&
    candidate.rendererChecksum === profile.rendererSha256 &&
    candidate.coreChecksum === profile.coreSha256
    ? (candidate as InkInstrumentationSentinel)
    : undefined;
}

/** Transform the matching Ink class so every capture includes render-mode facts. */
export function instrumentInkCore(path: string, source: string): string | undefined {
  if (!INK_CORE_PATTERN.test(path.split('?')[0] ?? '')) return undefined;
  const checksum = createHash('sha256').update(source).digest('hex');
  const profile = instrumentationProfiles().find((entry) => entry.coreSha256 === checksum);
  if (profile === undefined) return undefined;
  const needle = `        const { output, outputHeight, staticOutput } = render(this.rootNode, this.isScreenReaderEnabled);\n        this.options.onRender?.({ renderTime: performance.now() - startTime });`;
  const replacement = `        const { output, outputHeight, staticOutput } = render(this.rootNode, this.isScreenReaderEnabled);\n        globalThis[Symbol.for("termwright.ink.frame-context.v1")]?.(this.rootNode, Object.freeze({ interactive: this.interactive, alternateScreen: this.alternateScreen, debug: this.options.debug === true, stdoutIsTTY: this.options.stdout.isTTY === true, rows: getWindowSize(this.options.stdout).rows }));\n        this.options.onRender?.({ renderTime: performance.now() - startTime });`;
  if (source.split(needle).length !== 2) return undefined;
  const sentinelNeedle = `const noop = () => { };`;
  if (source.split(sentinelNeedle).length !== 2) return undefined;
  const sentinel = `const __termwrightInkSentinelSymbol = Symbol.for("termwright.ink.instrumentation.v1");\nconst __termwrightInkPriorSentinel = globalThis[__termwrightInkSentinelSymbol] ?? {};\nglobalThis[__termwrightInkSentinelSymbol] = Object.freeze({ ...__termwrightInkPriorSentinel, version: 1, frameworkVersion: "${profile.version}", coreChecksum: "${checksum}" });`;
  return source
    .replace(sentinelNeedle, `${sentinel}\n${sentinelNeedle}`)
    .replace(needle, replacement);
}

/** Transform only the byte-exact renderer shipped by Ink 7.1.1. */
export function instrumentInkRenderer(path: string, source: string): string | undefined {
  if (!INK_RENDERER_PATTERN.test(path.split('?')[0] ?? '')) return undefined;
  const checksum = createHash('sha256').update(source).digest('hex');
  const profile = instrumentationProfiles().find((entry) => entry.rendererSha256 === checksum);
  if (profile === undefined) return undefined;

  const insertion = "import Output from './output.js';";
  if (source.split(insertion).length !== 2) return undefined;
  let output = source.replace(insertion, `${insertion}\n${runtime(profile.version, checksum)}`);

  const screenReaderReturn = `            return {
                output,
                outputHeight,
                staticOutput: staticOutput ? \`${'${staticOutput}'}\\n\` : '',
            };`;
  const screenReaderReplacement = `            return __termwrightCaptureInkRenderer(node, {
                output,
                outputHeight,
                staticOutput: staticOutput ? \`${'${staticOutput}'}\\n\` : '',
            }, true);`;
  const normalReturn = `        return {
            output: generatedOutput,
            outputHeight,
            // Newline at the end is needed, because static output doesn't have one, so
            // interactive output will override last line of static output
            staticOutput: staticOutput ? \`${'${staticOutput.get().output}'}\\n\` : '',
        };`;
  const normalReplacement = `        return __termwrightCaptureInkRenderer(node, {
            output: generatedOutput,
            outputHeight,
            // Newline at the end is needed, because static output doesn't have one, so
            // interactive output will override last line of static output
            staticOutput: staticOutput ? \`${'${staticOutput.get().output}'}\\n\` : '',
        }, false);`;
  const emptyReturn = `    return {
        output: '',
        outputHeight: 0,
        staticOutput: '',
    };`;
  const emptyReplacement = `    return __termwrightCaptureInkRenderer(node, {
        output: '',
        outputHeight: 0,
        staticOutput: '',
    }, isScreenReaderEnabled);`;

  for (const [needle, replacement] of [
    [screenReaderReturn, screenReaderReplacement],
    [normalReturn, normalReplacement],
    [emptyReturn, emptyReplacement],
  ] as const) {
    if (output.split(needle).length !== 2) return undefined;
    output = output.replace(needle, replacement);
  }
  return output;
}

function runtime(frameworkVersion: string, checksum: string): string {
  return `const __termwrightInkCaptureSymbol = Symbol.for("termwright.ink.render-capture.v1");
const __termwrightInkSentinelSymbol = Symbol.for("termwright.ink.instrumentation.v1");
const __termwrightInkPriorSentinel = globalThis[__termwrightInkSentinelSymbol] ?? {};
globalThis[__termwrightInkSentinelSymbol] = Object.freeze({ ...__termwrightInkPriorSentinel, version: 1, frameworkVersion: "${frameworkVersion}", rendererChecksum: "${checksum}" });
const __termwrightCaptureInkRenderer = (root, result, screenReader) => {
    const capture = globalThis[__termwrightInkCaptureSymbol];
    if (typeof capture === "function") capture(root, result, screenReader);
    return result;
};`;
}

function instrumentationProfiles(): readonly InkInstrumentationProfile[] {
  const override = certificationOverride();
  return override === undefined ? BUILTIN_PROFILES : [override, ...BUILTIN_PROFILES];
}

function certificationOverride(): InkInstrumentationProfile | undefined {
  const raw = process.env['TERMWRIGHT_CERTIFICATION_HOOK_PROFILE'];
  if (raw === undefined) return undefined;
  if (process.env['GITHUB_ACTIONS'] !== 'true') return undefined;
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    const digest = process.env['TERMWRIGHT_CERTIFICATION_CANDIDATE_DIGEST'];
    const revision = process.env['TERMWRIGHT_CERTIFICATION_SOURCE_REVISION'];
    if (
      value['framework'] !== 'ink' ||
      !/^sha256:[a-f0-9]{64}$/u.test(digest ?? '') ||
      revision !== process.env['GITHUB_SHA'] ||
      value['sourceRevision'] !== revision ||
      value['candidateDigest'] !== digest ||
      typeof value['version'] !== 'string' ||
      !/^[a-f0-9]{64}$/u.test(String(value['rendererSha256'])) ||
      !/^[a-f0-9]{64}$/u.test(String(value['coreSha256']))
    )
      return undefined;
    return {
      version: value['version'],
      rendererSha256: String(value['rendererSha256']),
      coreSha256: String(value['coreSha256']),
    };
  } catch {
    return undefined;
  }
}
