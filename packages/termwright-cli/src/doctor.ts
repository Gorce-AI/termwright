import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createNodePtyBackend, inheritedSpawnEnv } from '@termwright/driver';
import { CERTIFIED_VITEST_VERSION } from '@termwright/test/vitest-engine';
import { TERMWRIGHT_RESOURCE_PROFILES } from './resource-profiles.js';
import { DEFAULT_TERMWRIGHT_HOST_TIMEOUTS } from './test-host.js';

export interface DoctorCheck {
  readonly name: string;
  readonly status: 'pass' | 'warn' | 'fail';
  readonly detail: string;
}

export interface DoctorReport {
  readonly ok: boolean;
  readonly checks: readonly DoctorCheck[];
  readonly effectiveConfig: {
    readonly mode: 'termwright-native-only';
    readonly engine: { readonly name: 'vitest'; readonly version: string };
    readonly defaultProfile: typeof TERMWRIGHT_RESOURCE_PROFILES.local;
    readonly profiles: typeof TERMWRIGHT_RESOURCE_PROFILES;
    readonly semantics: 'explicit-session-contract';
    readonly flakyPolicy: 'fail';
    readonly artifactValuePolicy: 'redacted';
    readonly hostTimeouts: typeof DEFAULT_TERMWRIGHT_HOST_TIMEOUTS;
  };
}

export async function runDoctor(cwd: string): Promise<DoctorReport> {
  const checks: DoctorCheck[] = [];
  const nodeMajor = Number(process.versions.node.split('.')[0]);
  const nodeCertified = nodeMajor === 22 || nodeMajor === 24;
  checks.push({
    name: 'Node.js',
    status: nodeCertified ? 'pass' : 'fail',
    detail: `${process.version}${nodeCertified ? ' (certified LTS line)' : ' (certified Termwright host supports Node.js 22 and 24)'}`,
  });

  try {
    const require = createRequire(join(cwd, 'package.json'));
    const manifest = require('vitest/package.json') as { version?: string };
    const version = manifest.version ?? 'unknown';
    checks.push({
      name: 'Vitest',
      status: version === CERTIFIED_VITEST_VERSION ? 'pass' : 'fail',
      detail: version === CERTIFIED_VITEST_VERSION
        ? `${version} (exact-certified engine)`
        : `${version}; Termwright requires exactly ${CERTIFIED_VITEST_VERSION}`,
    });
  } catch {
    checks.push({ name: 'Vitest', status: 'fail', detail: 'not resolvable from this project' });
  }

  checks.push(await checkPty());

  const locale = [process.env['LC_ALL'], process.env['LC_CTYPE'], process.env['LANG']]
    .find((value) => value !== undefined && value !== '');
  const utf8 = locale !== undefined && /utf-?8/iu.test(locale);
  checks.push({
    name: 'UTF-8 locale',
    status: utf8 ? 'pass' : 'warn',
    detail: locale ?? 'no LC_ALL, LC_CTYPE or LANG value',
  });

  checks.push(await checkWritable(cwd));
  if (process.platform === 'linux' && libcFamily() === 'musl') {
    checks.push({
      name: 'Linux libc',
      status: 'warn',
      detail: 'musl detected; some native framework integrations publish fewer capabilities',
    });
  } else {
    checks.push({ name: 'Platform', status: 'pass', detail: `${process.platform} ${process.arch}` });
  }

  return Object.freeze({
    ok: checks.every((check) => check.status !== 'fail'),
    checks: Object.freeze(checks.map((check) => Object.freeze(check))),
    effectiveConfig: Object.freeze({
      mode: 'termwright-native-only',
      engine: Object.freeze({ name: 'vitest', version: CERTIFIED_VITEST_VERSION }),
      defaultProfile: TERMWRIGHT_RESOURCE_PROFILES.local,
      profiles: TERMWRIGHT_RESOURCE_PROFILES,
      semantics: 'explicit-session-contract',
      flakyPolicy: 'fail',
      artifactValuePolicy: 'redacted',
      hostTimeouts: DEFAULT_TERMWRIGHT_HOST_TIMEOUTS,
    }),
  });
}

async function checkPty(): Promise<DoctorCheck> {
  let pty: ReturnType<ReturnType<typeof createNodePtyBackend>['spawn']> | undefined;
  try {
    pty = createNodePtyBackend().spawn({
      command: [process.execPath, '-e', "process.stdout.write('termwright-doctor'); process.exit(0)"],
      env: inheritedSpawnEnv(),
      columns: 20,
      rows: 4,
    });
    const proc = pty;
    const text: Uint8Array[] = [];
    const result = await new Promise<{ code: number | null; signal: string | null }>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('PTY smoke timed out')), 2_000);
      proc.onData((data) => text.push(data));
      proc.onExit((status) => {
        clearTimeout(timer);
        resolve(status);
      });
    });
    const output = new TextDecoder().decode(Buffer.concat(text.map((part) => Buffer.from(part))));
    if (result.code !== 0 || !output.includes('termwright-doctor')) throw new Error(`unexpected PTY result ${String(result.code)}`);
    return { name: 'PTY backend', status: 'pass', detail: 'spawn, output and exit verified' };
  } catch (error) {
    return { name: 'PTY backend', status: 'fail', detail: error instanceof Error ? error.message : String(error) };
  } finally {
    pty?.dispose();
  }
}

async function checkWritable(cwd: string): Promise<DoctorCheck> {
  try {
    const directory = await mkdtemp(join(cwd, '.termwright-doctor-'));
    await rm(directory, { recursive: true, force: true });
    return { name: 'Artifact directory', status: 'pass', detail: cwd };
  } catch (error) {
    return { name: 'Artifact directory', status: 'fail', detail: error instanceof Error ? error.message : String(error) };
  }
}

function libcFamily(): string | undefined {
  const report = process.report?.getReport() as { header?: { glibcVersionRuntime?: string } } | undefined;
  return report?.header?.glibcVersionRuntime === undefined ? 'musl' : 'glibc';
}

export function formatDoctor(report: DoctorReport): string {
  const icon = { pass: '✓', warn: '⚠', fail: '✗' } as const;
  return [
    'Termwright Doctor',
    '',
    ...report.checks.map((check) => `${icon[check.status]} ${check.name}: ${check.detail}`),
    '',
    `Native host: Vitest ${report.effectiveConfig.engine.version}, ` +
      `${report.effectiveConfig.defaultProfile.scheduler.pool}, ` +
      `${report.effectiveConfig.defaultProfile.scheduler.maxWorkers} workers, ` +
      `${report.effectiveConfig.defaultProfile.capacities.ptySession} PTYs, ` +
      `flaky=${report.effectiveConfig.flakyPolicy}, artifacts=${report.effectiveConfig.artifactValuePolicy}`,
    '',
    report.ok ? 'Ready to run Termwright.' : 'Termwright needs attention before tests can run.',
  ].join('\n');
}
