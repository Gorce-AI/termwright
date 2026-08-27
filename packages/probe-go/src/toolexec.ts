/** Add-only Go compilation units injected through the official `-toolexec` seam. */

import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const WRAPPER_PROTOCOL = 'termwright-go-toolexec-v1';

export interface GoToolExecUnit {
  /** Exact import path reported in `TOOLEXEC_IMPORTPATH`. */
  readonly packagePath: string;
  /** Logical add-only filename used for collision detection. */
  readonly targetFile: string;
  /** Source owned by Termwright. */
  readonly source: string;
  /** Digest of `source`; upstream bytes are deliberately not hashed. */
  readonly sourceDigest: string;
  /** Direct imports introduced by this unit, absent from upstream importcfg. */
  readonly imports?: readonly string[];
}

export interface PrepareGoToolExecOptions {
  readonly moduleDir: string;
  readonly outputDir: string;
  readonly units: readonly GoToolExecUnit[];
  readonly env?: NodeJS.ProcessEnv;
}

export interface PreparedGoToolExec {
  readonly wrapperFile: string;
  readonly configDigest: string;
  /** Insert after `build`, `test`, or another build-aware Go subcommand. */
  readonly goArgs: readonly [string, string];
  readonly env: NodeJS.ProcessEnv;
  readonly sources: readonly string[];
}

export class GoToolExecError extends Error {
  constructor(
    readonly code:
      | 'invalid-unit'
      | 'source-mismatch'
      | 'package-unavailable'
      | 'target-collision'
      | 'toolexec-conflict'
      | 'go-environment'
      | 'cross-compilation'
      | 'wrapper-build-failed',
    message: string,
  ) {
    super(message);
    this.name = 'GoToolExecError';
  }
}

export function digestGoToolExecSource(source: string): string {
  return `sha256:${createHash('sha256').update(source).digest('hex')}`;
}

/**
 * Build one compiler wrapper that injects every requested unit by exact import
 * path. Unlike `-overlay`, `-toolexec` is allowed to compile dependencies from
 * GOMODCACHE because it never claims to replace a file beneath that directory.
 */
export async function prepareGoToolExec(
  options: PrepareGoToolExecOptions,
): Promise<PreparedGoToolExec> {
  if (options.units.length === 0) {
    throw new GoToolExecError(
      'invalid-unit',
      'a Go tool executor needs at least one compilation unit',
    );
  }
  const env = options.env ?? process.env;
  const goEnvironment = await inspectGoEnvironment(options.moduleDir, env);
  if (/(?:^|\s)-toolexec(?:=|\s|$)/u.test(goEnvironment.GOFLAGS)) {
    throw new GoToolExecError(
      'toolexec-conflict',
      'GOFLAGS already selects a tool executor; Termwright requires one composed compiler wrapper per build',
    );
  }
  if (
    goEnvironment.GOOS !== goEnvironment.GOHOSTOS ||
    goEnvironment.GOARCH !== goEnvironment.GOHOSTARCH
  ) {
    throw new GoToolExecError(
      'cross-compilation',
      `Termwright's compiler wrapper must execute on the build host; target ` +
        `${goEnvironment.GOOS}/${goEnvironment.GOARCH} differs from host ` +
        `${goEnvironment.GOHOSTOS}/${goEnvironment.GOHOSTARCH}`,
    );
  }

  const outputRoot = resolve(options.outputDir);
  const seenTargets = new Set<string>();
  for (const unit of options.units) {
    validateUnit(unit);
    const actualDigest = digestGoToolExecSource(unit.source);
    if (actualDigest !== unit.sourceDigest) {
      throw new GoToolExecError(
        'source-mismatch',
        `${unit.packagePath}/${unit.targetFile} source hashes ${actualDigest}, not ${unit.sourceDigest}`,
      );
    }
    const owner = `${unit.packagePath}\0${unit.targetFile}`;
    if (seenTargets.has(owner)) {
      throw new GoToolExecError(
        'target-collision',
        `${unit.packagePath}/${unit.targetFile} is declared more than once`,
      );
    }
    seenTargets.add(owner);
  }
  const linkFiles = await resolveImportFiles(
    options.units.flatMap((unit) => unit.imports ?? []),
    options.moduleDir,
    env,
    true,
  );
  // The transitive export lookup necessarily contains every directly
  // requested archive. Re-running `go list -export` once per unit only made a
  // cold toolchain compile the same graph again and put compiler startup on
  // the critical path of every preparation.
  const unitImportFiles = options.units.map((unit) =>
    selectImportFiles(unit.imports ?? [], linkFiles),
  );
  const packageDirs = await resolvePackageDirs(
    options.units.map((unit) => unit.packagePath),
    options.moduleDir,
    env,
  );
  const configDigest = digestConfiguration(options.units, await digestResolvedImports(linkFiles));
  const outputDir = join(outputRoot, configDigest.slice('sha256:'.length));
  await mkdir(outputDir, { recursive: true });
  const entries: {
    packagePath: string;
    targetFile: string;
    sourceFile: string;
    source: string;
    sourceDigest: string;
    importFiles: Readonly<Record<string, string>>;
  }[] = [];

  for (const [index, unit] of options.units.entries()) {
    const packageDir = packageDirs[unit.packagePath]!;
    if (await targetExists(join(packageDir, unit.targetFile))) {
      throw new GoToolExecError(
        'target-collision',
        `${unit.packagePath}/${unit.targetFile} already exists; add-only instrumentation cannot replace it`,
      );
    }

    const sourceFile = join(outputDir, `${String(index).padStart(3, '0')}-${unit.targetFile}`);
    await writeFile(sourceFile, unit.source, 'utf8');
    if (digestGoToolExecSource(await readFile(sourceFile, 'utf8')) !== unit.sourceDigest) {
      throw new GoToolExecError(
        'source-mismatch',
        `${sourceFile} changed while materialising the compiler unit`,
      );
    }
    entries.push({
      packagePath: unit.packagePath,
      targetFile: unit.targetFile,
      sourceFile,
      source: unit.source,
      sourceDigest: unit.sourceDigest,
      importFiles: unitImportFiles[index]!,
    });
  }
  const wrapperSource = renderWrapper(entries, configDigest, linkFiles);
  const wrapperSourceFile = join(outputDir, 'termwright-toolexec.go');
  const wrapperFile = join(
    outputDir,
    process.platform === 'win32' ? 'termwright-toolexec.exe' : 'termwright-toolexec',
  );
  await writeFile(wrapperSourceFile, wrapperSource, 'utf8');
  try {
    await run('go', ['build', '-o', wrapperFile, wrapperSourceFile], { env });
  } catch (error) {
    throw new GoToolExecError(
      'wrapper-build-failed',
      `could not build the Go compiler wrapper: ${message(error)}`,
    );
  }

  return {
    wrapperFile,
    configDigest,
    goArgs: ['-toolexec', quoteGoCommandArgument(wrapperFile)],
    env: { ...env },
    sources: entries.map((entry) => entry.sourceFile),
  };
}

function digestConfiguration(
  entries: readonly {
    packagePath: string;
    targetFile: string;
    sourceDigest: string;
    imports?: readonly string[];
  }[],
  importDigests: Readonly<Record<string, string>>,
): string {
  // Identity describes the intervention, not the temporary directory holding
  // it. Including outputRoot made byte-identical units invalidate Go's entire
  // tool action cache on every run.
  const encoded = JSON.stringify({ protocol: WRAPPER_PROTOCOL, entries, importDigests });
  return `sha256:${createHash('sha256').update(encoded).digest('hex')}`;
}

async function digestResolvedImports(
  files: Readonly<Record<string, string>>,
): Promise<Readonly<Record<string, string>>> {
  const digests: Record<string, string> = {};
  try {
    // Read sequentially: a framework unit may pull a wide transitive graph,
    // and preparation must not retain every export archive in memory at once.
    for (const [importPath, archive] of Object.entries(files).sort(([left], [right]) =>
      left.localeCompare(right),
    )) {
      digests[importPath] = `sha256:${createHash('sha256')
        .update(await readFile(archive))
        .digest('hex')}`;
    }
    return digests;
  } catch (error) {
    throw new GoToolExecError(
      'package-unavailable',
      `could not fingerprint injected import archives: ${message(error)}`,
    );
  }
}

function renderWrapper(
  entries: readonly {
    packagePath: string;
    sourceFile: string;
    source: string;
    sourceDigest: string;
    importFiles: Readonly<Record<string, string>>;
  }[],
  configDigest: string,
  linkFiles: Readonly<Record<string, string>>,
): string {
  const grouped = new Map<
    string,
    {
      sourceFile: string;
      source: string;
      sourceDigest: string;
      importFiles: Readonly<Record<string, string>>;
    }[]
  >();
  for (const entry of entries) {
    const sources = grouped.get(entry.packagePath) ?? [];
    sources.push({
      sourceFile: entry.sourceFile,
      source: entry.source,
      sourceDigest: entry.sourceDigest,
      importFiles: entry.importFiles,
    });
    grouped.set(entry.packagePath, sources);
  }
  const cases = [...grouped.entries()]
    .map(([packagePath, sources]) => {
      const checks = sources
        .map(
          ({ sourceFile, source, sourceDigest }) =>
            `\t\tverifySource(${JSON.stringify(sourceFile)}, ${JSON.stringify(source)}, ${JSON.stringify(sourceDigest)})`,
        )
        .join('\n');
      const paths = sources.map(({ sourceFile }) => JSON.stringify(sourceFile)).join(', ');
      const importFiles = Object.fromEntries(
        sources.flatMap((source) => Object.entries(source.importFiles)),
      );
      const imports = Object.entries(importFiles)
        .map(([path, archive]) => `${JSON.stringify(path)}: ${JSON.stringify(archive)}`)
        .join(', ');
      const augment =
        imports.length === 0
          ? ''
          : `\n\t\tvar cleanup func()\n\t\targs, cleanup = augmentImportConfig(args, map[string]string{${imports}})\n\t\tdefer cleanup()`;
      return `\tif matchesImportPath(importPath, ${JSON.stringify(packagePath)}) {\n${checks}\n\t\targs = append(args, ${paths})${augment}\n\t}`;
    })
    .join('\n');
  const allChecks = entries
    .map(
      ({ sourceFile, source, sourceDigest }) =>
        `\tverifySource(${JSON.stringify(sourceFile)}, ${JSON.stringify(source)}, ${JSON.stringify(sourceDigest)})`,
    )
    .join('\n');
  const linkImports = Object.entries(linkFiles)
    .map(([path, archive]) => `${JSON.stringify(path)}: ${JSON.stringify(archive)}`)
    .join(', ');
  return `package main

import (
  "fmt"
  "os"
  "os/exec"
  "path/filepath"
  "sort"
  "strings"
)

const identity = ${JSON.stringify(`${WRAPPER_PROTOCOL}:${configDigest}`)}

func verifySource(path string, wantSource string, wantDigest string) {
  source, err := os.ReadFile(path)
  if err != nil {
    fmt.Fprintf(os.Stderr, "termwright toolexec: cannot read %s: %v\\n", path, err)
    os.Exit(1)
  }
  // These exact owned bytes are embedded in the wrapper. Direct comparison is
  // stronger than recomputing their digest and keeps Go's crypto graph off the
  // cold compiler path.
  if string(source) != wantSource {
    fmt.Fprintf(os.Stderr, "termwright toolexec: injected source %s content differs from owned %s\\n", path, wantDigest)
    os.Exit(1)
  }
}

func matchesImportPath(got string, want string) bool {
  // go test recompiles an internal-test variant as
  // "pkg/path [pkg/path.test]". It is still the same package namespace. An
  // external pkg_test variant is deliberately not matched.
  return got == want || got == want+" ["+want+".test]"
}

func augmentImportConfig(args []string, imports map[string]string) ([]string, func()) {
  index := -1
  for candidate := 0; candidate+1 < len(args); candidate++ {
    if args[candidate] == "-importcfg" {
      index = candidate + 1
      break
    }
  }
  if index < 0 {
    fmt.Fprintln(os.Stderr, "termwright toolexec: compiler invocation has no -importcfg")
    os.Exit(1)
  }
  original, err := os.ReadFile(args[index])
  if err != nil {
    fmt.Fprintf(os.Stderr, "termwright toolexec: cannot read importcfg: %v\\n", err)
    os.Exit(1)
  }
  generated, err := os.CreateTemp(filepath.Dir(args[index]), "termwright-importcfg-*")
  if err != nil {
    fmt.Fprintf(os.Stderr, "termwright toolexec: cannot create importcfg: %v\\n", err)
    os.Exit(1)
  }
  content := string(original)
  if _, err := generated.Write(original); err != nil {
    fmt.Fprintf(os.Stderr, "termwright toolexec: cannot copy importcfg: %v\\n", err)
    os.Exit(1)
  }
  if len(original) > 0 && original[len(original)-1] != '\\n' {
    _, _ = generated.WriteString("\\n")
  }
  paths := make([]string, 0, len(imports))
  for path := range imports {
    paths = append(paths, path)
  }
  sort.Strings(paths)
  for _, path := range paths {
    archive := imports[path]
    declaration := "packagefile " + path + "="
    if strings.Contains(content, "\\n"+declaration) || strings.HasPrefix(content, declaration) {
      continue
    }
    if _, err := fmt.Fprintf(generated, "packagefile %s=%s\\n", path, archive); err != nil {
      fmt.Fprintf(os.Stderr, "termwright toolexec: cannot augment importcfg: %v\\n", err)
      os.Exit(1)
    }
  }
  if err := generated.Close(); err != nil {
    fmt.Fprintf(os.Stderr, "termwright toolexec: cannot close importcfg: %v\\n", err)
    os.Exit(1)
  }
  args[index] = generated.Name()
  return args, func() { _ = os.Remove(generated.Name()) }
}

func main() {
  if len(os.Args) < 2 {
    fmt.Fprintln(os.Stderr, "termwright toolexec: missing tool path")
    os.Exit(2)
  }
  tool := os.Args[1]
  args := append([]string(nil), os.Args[2:]...)
  if len(args) == 1 && args[0] == "-V=full" {
${allChecks}
    output, err := exec.Command(tool, args...).Output()
    if err != nil {
      fmt.Fprintln(os.Stderr, err)
      os.Exit(1)
    }
    fmt.Printf("%s termwright=%s\\n", strings.TrimSpace(string(output)), identity)
    return
  }
  toolName := strings.TrimSuffix(filepath.Base(tool), ".exe")
  if toolName == "compile" {
    importPath := os.Getenv("TOOLEXEC_IMPORTPATH")
${cases}
  }
  if toolName == "link" {
    var cleanup func()
    args, cleanup = augmentImportConfig(args, map[string]string{${linkImports}})
    defer cleanup()
  }
  command := exec.Command(tool, args...)
  command.Stdin = os.Stdin
  command.Stdout = os.Stdout
  command.Stderr = os.Stderr
  if err := command.Run(); err != nil {
    if exit, ok := err.(*exec.ExitError); ok {
      os.Exit(exit.ExitCode())
    }
    fmt.Fprintln(os.Stderr, err)
    os.Exit(1)
  }
}
`;
}

/** @internal Exported only for a platform-independent quoting regression test. */
export function quoteGoCommandArgument(value: string): string {
  // cmd/go parses -toolexec with cmd/internal/quoted.Split, not JSON or shell
  // escaping. In particular, it does not unescape backslashes inside quotes;
  // JSON.stringify therefore corrupts every Windows path before execution.
  if (!/[\s'"]/u.test(value)) return value;
  if (!value.includes("'")) return `'${value}'`;
  if (!value.includes('"')) return `"${value}"`;
  throw new GoToolExecError(
    'go-environment',
    `the tool executor path cannot be represented by Go's -toolexec grammar: ${JSON.stringify(value)}`,
  );
}

function validateUnit(unit: GoToolExecUnit): void {
  if (unit.packagePath.length === 0 || !/^zz_[A-Za-z0-9_.-]+\.go$/u.test(unit.targetFile)) {
    throw new GoToolExecError(
      'invalid-unit',
      `invalid add-only Go unit ${unit.packagePath}/${unit.targetFile}; use a collision-resistant zz_*.go name`,
    );
  }
  if (unit.targetFile.endsWith('_test.go')) {
    throw new GoToolExecError(
      'invalid-unit',
      `${unit.targetFile} must be compiled by build and test commands`,
    );
  }
  if (/^\s*\/\/\s*(?:go:build|\+build)\b/mu.test(unit.source)) {
    throw new GoToolExecError(
      'invalid-unit',
      `${unit.packagePath}/${unit.targetFile} must not carry build constraints; an injected unit applies to every build`,
    );
  }
  const platform = [
    'aix',
    'android',
    'darwin',
    'dragonfly',
    'freebsd',
    'illumos',
    'ios',
    'js',
    'linux',
    'netbsd',
    'openbsd',
    'plan9',
    'solaris',
    'wasip1',
    'windows',
    '386',
    'amd64',
    'arm',
    'arm64',
    'loong64',
    'mips',
    'mips64',
    'mips64le',
    'mipsle',
    'ppc64',
    'ppc64le',
    'riscv64',
    's390x',
    'wasm',
  ].join('|');
  if (new RegExp(`_(?:${platform})(?:_(?:${platform}))?\\.go$`, 'u').test(unit.targetFile)) {
    throw new GoToolExecError(
      'invalid-unit',
      `${unit.packagePath}/${unit.targetFile} must not select a GOOS or GOARCH`,
    );
  }
  for (const imported of unit.imports ?? []) {
    if (!/^[A-Za-z0-9_.~\-/]+$/u.test(imported)) {
      throw new GoToolExecError(
        'invalid-unit',
        `invalid injected import ${JSON.stringify(imported)}`,
      );
    }
  }
}

async function resolveImportFiles(
  imports: readonly string[],
  moduleDir: string,
  env: NodeJS.ProcessEnv,
  includeDependencies: boolean,
): Promise<Readonly<Record<string, string>>> {
  const unique = [...new Set(imports)].filter(requiresExportArchive).sort();
  if (unique.length === 0) return {};
  try {
    const result = await run(
      'go',
      [
        'list',
        ...(includeDependencies ? ['-deps'] : []),
        '-export',
        '-f={{.ImportPath}}\t{{.Export}}',
        ...unique,
      ],
      { cwd: moduleDir, env },
    );
    const resolved: Record<string, string> = {};
    for (const line of result.stdout.trim().split(/\r?\n/u)) {
      const separator = line.indexOf('\t');
      if (separator < 1 || separator === line.length - 1) continue;
      resolved[line.slice(0, separator)] = line.slice(separator + 1);
    }
    for (const imported of unique) {
      if (!resolved[imported]) {
        throw new Error(`go list returned no export archive for ${imported}`);
      }
    }
    return resolved;
  } catch (error) {
    throw new GoToolExecError(
      'package-unavailable',
      `could not resolve injected imports: ${message(error)}`,
    );
  }
}

function selectImportFiles(
  imports: readonly string[],
  resolved: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> {
  return Object.fromEntries(
    [...new Set(imports)]
      .filter(requiresExportArchive)
      .sort()
      .map((importPath) => [importPath, resolved[importPath]!]),
  );
}

function requiresExportArchive(importPath: string): boolean {
  // `unsafe` is a compiler intrinsic. It intentionally has no export archive
  // and needs no packagefile entry in either compiler or linker importcfg.
  return importPath !== 'unsafe';
}

async function resolvePackageDirs(
  packages: readonly string[],
  moduleDir: string,
  env: NodeJS.ProcessEnv,
): Promise<Readonly<Record<string, string>>> {
  const unique = [...new Set(packages)].sort();
  try {
    const result = await run('go', ['list', '-f={{.ImportPath}}\t{{.Dir}}', ...unique], {
      cwd: moduleDir,
      env,
    });
    const resolved: Record<string, string> = {};
    for (const line of result.stdout.trim().split(/\r?\n/u)) {
      const separator = line.indexOf('\t');
      if (separator < 1 || separator === line.length - 1) continue;
      resolved[line.slice(0, separator)] = line.slice(separator + 1);
    }
    for (const packagePath of unique) {
      if (!resolved[packagePath])
        throw new Error(`go list returned no directory for ${packagePath}`);
    }
    return resolved;
  } catch (error) {
    throw new GoToolExecError(
      'package-unavailable',
      `could not resolve injected package directories: ${message(error)}`,
    );
  }
}

async function targetExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw new GoToolExecError(
      'package-unavailable',
      `cannot inspect add-only target ${path}: ${message(error)}`,
    );
  }
}

async function inspectGoEnvironment(
  moduleDir: string,
  env: NodeJS.ProcessEnv,
): Promise<{
  GOFLAGS: string;
  GOOS: string;
  GOARCH: string;
  GOHOSTOS: string;
  GOHOSTARCH: string;
}> {
  try {
    const result = await run(
      'go',
      ['env', '-json', 'GOFLAGS', 'GOOS', 'GOARCH', 'GOHOSTOS', 'GOHOSTARCH'],
      { cwd: moduleDir, env },
    );
    const parsed = JSON.parse(result.stdout) as Record<string, unknown>;
    for (const field of ['GOFLAGS', 'GOOS', 'GOARCH', 'GOHOSTOS', 'GOHOSTARCH'] as const) {
      if (typeof parsed[field] !== 'string') throw new Error(`go env omitted ${field}`);
    }
    return parsed as {
      GOFLAGS: string;
      GOOS: string;
      GOARCH: string;
      GOHOSTOS: string;
      GOHOSTARCH: string;
    };
  } catch (error) {
    throw new GoToolExecError(
      'go-environment',
      `could not inspect the effective Go build environment: ${message(error)}`,
    );
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
