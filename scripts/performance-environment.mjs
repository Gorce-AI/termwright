import { execFile } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const DESCRIPTOR_KIND = 'termwright-performance-environment';
const DESCRIPTOR_VERSION = 1;
const CLASS_PATTERN = /^(darwin|linux)-(arm64|x64)-node(\d+)-go(\d+\.\d+)-bun(\d+\.\d+\.\d+)$/u;

export function qualifyPerformanceEnvironment(runnerClass, observed) {
  const match = CLASS_PATTERN.exec(runnerClass);
  if (match === null) throw new Error(`invalid performance runner class ${runnerClass}`);
  const [, platform, arch, nodeMajor, goLine, bunVersion] = match;
  const expected = { platform, arch, nodeMajor, goLine, bunVersion };
  for (const [name, actual] of Object.entries({
    platform: observed.platform,
    arch: observed.arch,
    nodeMajor: major(observed.nodeVersion),
    goLine: majorMinor(observed.goVersion),
    bunVersion: observed.bunVersion,
  })) {
    if (actual !== expected[name]) {
      throw new Error(
        `performance runner class ${runnerClass} requires ${name}=${expected[name]}, observed ${String(actual)}`,
      );
    }
  }
  if (typeof observed.runnerImage !== 'string' || observed.runnerImage.length === 0) {
    throw new Error('performance runner image is missing');
  }
  return {
    kind: DESCRIPTOR_KIND,
    schemaVersion: DESCRIPTOR_VERSION,
    class: runnerClass,
    runner: {
      image: observed.runnerImage,
      platform: observed.platform,
      arch: observed.arch,
    },
    toolchains: {
      node: { qualified: nodeMajor, resolved: observed.nodeVersion },
      go: { qualified: goLine, resolved: observed.goVersion },
      bun: { qualified: bunVersion, resolved: observed.bunVersion },
    },
  };
}

export function validatePerformanceEnvironment(value, runtime = undefined) {
  if (value?.kind !== DESCRIPTOR_KIND || value.schemaVersion !== DESCRIPTOR_VERSION) {
    throw new Error('unsupported performance environment descriptor');
  }
  const observed = {
    runnerImage: value.runner?.image,
    platform: runtime?.platform ?? value.runner?.platform,
    arch: runtime?.arch ?? value.runner?.arch,
    nodeVersion: runtime?.nodeVersion ?? value.toolchains?.node?.resolved,
    goVersion: value.toolchains?.go?.resolved,
    bunVersion: value.toolchains?.bun?.resolved,
  };
  const qualified = qualifyPerformanceEnvironment(value.class, observed);
  if (
    qualified.runner.platform !== value.runner?.platform ||
    qualified.runner.arch !== value.runner?.arch
  ) {
    throw new Error(
      'performance environment descriptor runtime does not match its recorded runner',
    );
  }
  for (const name of ['node', 'go', 'bun']) {
    if (
      qualified.toolchains[name].qualified !== value.toolchains?.[name]?.qualified ||
      qualified.toolchains[name].resolved !== value.toolchains?.[name]?.resolved
    ) {
      throw new Error(`performance environment descriptor ${name} qualification is not canonical`);
    }
  }
  return value;
}

export async function observePerformanceEnvironment(runnerClass, runnerImage) {
  const [{ stdout: goStdout }, { stdout: bunStdout }] = await Promise.all([
    execute('go', ['version']),
    execute('bun', ['--version']),
  ]);
  const goVersion = /\bgo(\d+\.\d+(?:\.\d+)?)\b/u.exec(goStdout)?.[1];
  if (goVersion === undefined) throw new Error(`cannot parse go version from ${goStdout.trim()}`);
  return qualifyPerformanceEnvironment(runnerClass, {
    runnerImage,
    platform: process.platform,
    arch: process.arch,
    nodeVersion: process.versions.node,
    goVersion,
    bunVersion: bunStdout.trim(),
  });
}

function major(version) {
  return typeof version === 'string' ? /^(\d+)\./u.exec(version)?.[1] : undefined;
}

function majorMinor(version) {
  return typeof version === 'string' ? /^(\d+\.\d+)(?:\.|$)/u.exec(version)?.[1] : undefined;
}

async function main(argv) {
  const options = Object.fromEntries(
    Array.from({ length: argv.length / 2 }, (_, index) => [
      argv[index * 2]?.replace(/^--/u, ''),
      argv[index * 2 + 1],
    ]),
  );
  if (argv.length !== 6 || !options.class || !options.runner || !options.output) {
    throw new Error(
      'usage: performance-environment.mjs --class <class> --runner <image> --output <path>',
    );
  }
  const descriptor = await observePerformanceEnvironment(options.class, options.runner);
  await writeFile(resolve(options.output), `${JSON.stringify(descriptor, null, 2)}\n`, 'utf8');
  process.stdout.write(
    `performance environment ${descriptor.class} written to ${options.output}\n`,
  );
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  await main(process.argv.slice(2));
}
