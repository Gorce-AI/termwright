import { readdir, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { execPath } from 'node:process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { certifiedProjectShards, projectSelectorArguments } from './ci-project-shards.mjs';

async function collectVitestConfigs(directory, output) {
  const children = await readdir(new URL(`../${directory}/`, import.meta.url), {
    withFileTypes: true,
  });
  for (const child of children) {
    const file = `${directory}/${child.name}`;
    if (child.isDirectory()) {
      if (!['node_modules', 'dist', 'target', '.venv'].includes(child.name))
        await collectVitestConfigs(file, output);
    } else if (/(?:vitest.*config|config.*vitest)\.[cm]?[jt]s$/u.test(child.name))
      output.push(file);
  }
}

async function collectTestSources(directory, output) {
  const children = await readdir(new URL(`../${directory}/`, import.meta.url), {
    withFileTypes: true,
  });
  for (const child of children) {
    const file = `${directory}/${child.name}`;
    if (child.isDirectory()) {
      if (!['node_modules', 'dist', 'target', '.venv'].includes(child.name))
        await collectTestSources(file, output);
    } else if (/\.test\.[cm]?[jt]sx?$/u.test(child.name)) output.push(file);
  }
}

function workflowJobBlocks(source) {
  const jobs = source.indexOf('\njobs:\n');
  if (jobs === -1) return [];
  const body = source.slice(jobs + 1);
  const starts = [...body.matchAll(/^ {2}[A-Za-z0-9_-]+:\n/gmu)].map((match) => match.index);
  return starts.map((start, index) => body.slice(start, starts[index + 1] ?? body.length));
}

function expectExactNeed(job, dependency) {
  expect(job.match(/^    needs:.*$/gmu)).toEqual([`    needs: ${dependency}`]);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function expectArtifactStep(job, action, name, path) {
  expect(job).toMatch(
    new RegExp(
      `      - uses: actions/${action}@[0-9a-f]{40}[^\\n]*\\n` +
        '        with:\\n' +
        `          name: ${escapeRegExp(name)}\\n` +
        '(?:          #[^\\n]*\\n)*' +
        `          path: ${escapeRegExp(path)}(?:\\n|$)`,
      'u',
    ),
  );
}

function expectCommandBefore(source, prerequisite, dependent) {
  expect(source).toContain(prerequisite);
  expect(source).toContain(dependent);
  expect(source.indexOf(prerequisite)).toBeLessThan(source.indexOf(dependent));
}

describe('the native host is the only Termwright test entrypoint', () => {
  it('uses a causal marker handshake without Windows named-pipe half-close', async () => {
    const child = await readFile(
      new URL('./fixtures/conpty-console-marker.mjs', import.meta.url),
      'utf8',
    );
    const parent = await readFile(
      new URL('./fixtures/conpty-console-marker.ps1', import.meta.url),
      'utf8',
    );
    const nativeTest = await readFile(
      new URL('../packages/pty/src/windows-native.win.test.ts', import.meta.url),
      'utf8',
    );

    expect(child).toContain("socket.write('DONE\\n');");
    expect(child).toContain("} else if (command === 'CLOSE') {");
    expect(child).toContain("socket.write('CLOSED\\n', () => {");
    expect(child).toContain('server.close();');
    expect(child).not.toMatch(/^\s*socket\.end\(/mu);
    expect(parent).toContain('$writer.WriteLine("CLOSE")');
    expect(parent).toContain('$reader.ReadLine() -ne "CLOSED"');
    expect(nativeTest).toContain('onTestFinished(() => handle.dispose());');
    expect(nativeTest).toContain('spawnWindowsPty as spawnUnownedWindowsPty');
  });

  it('parses the exact packed PTY certification payload', async () => {
    const source = await readFile(new URL('./check-installed-pty.mjs', import.meta.url), 'utf8');
    expect(() =>
      execFileSync(
        execPath,
        [
          fileURLToPath(new URL('./check-installed-pty.mjs', import.meta.url)),
          '--check-probe-syntax',
        ],
        { stdio: 'pipe' },
      ),
    ).not.toThrow();
    expect(source).toMatch(
      /if \(process\.platform === 'win32'\) \{\n  \/\/ A passthrough ConPTY preserves the application's WriteConsole boundaries\./u,
    );
    expect(source).toContain(
      "const fragmentedSyntax = spawnSync(process.execPath, ['--check', '-']",
    );
    expect(source).toContain('attachHostControlResponder(handle');
    expect(source).toContain('const release = session.onData(answer);');
    expect(source).toContain(
      "error.message === 'ConPTY input is closed' &&\n        session.treeState() === 'gone'",
    );
    expect(source).toContain('const closeOwnedInputAfterExit = (session, releaseHostControl) => {');
    expect(source).toContain(
      'try {\n      releaseHostControl();\n    } finally {\n      // Exit and trailing output can share one native delivery batch.',
    );
    expect(source).toContain('queueMicrotask(() => session.closeInput());');
    expect(source).toContain(
      'closeOwnedInputAfterExit(session, attachHostControlResponder(session, collected.text));',
    );
    expect(source).toContain(
      "observed.includes(';APP-MODE-REPLY:1b5b3f323032363b322479;ESC-READY')",
    );
    expect(source).not.toContain("observed.includes(';APP-CPR:1b5b393b313752;ESC-READY')");
    expect(source).toContain(
      'resizeSession.onData((data) => resizeOutput.push(Buffer.from(data)));',
    );
    expect(source).toContain('const releaseResizeResponder = resizeSession.onData(() => {');
    expect(source).toContain('closeOwnedInputAfterExit(resizeSession, releaseResizeResponder);');
    expect(source).toContain("await waitForText(fragmented, 'FRAGMENTED-READY');");
    expect(source).toContain("'--force-node-api-uncaught-exceptions-policy=true', certifierPath");
    expect(source).toContain("stdio: ['ignore', 'inherit', 'inherit']");
  });

  it('keeps repository and release certification single-attempt', async () => {
    const rootConfig = (await import('../vitest.config.ts')).default;
    const ci = await readFile(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
    const release = await readFile(
      new URL('../.github/workflows/release.yml', import.meta.url),
      'utf8',
    );
    const preview = await readFile(
      new URL('../.github/workflows/preview-release.yml', import.meta.url),
      'utf8',
    );
    const reliability = await readFile(
      new URL('../.github/workflows/reliability.yml', import.meta.url),
      'utf8',
    );
    const manifest = JSON.parse(
      await readFile(new URL('../package.json', import.meta.url), 'utf8'),
    );
    expect(rootConfig.test.retry).toBe(0);
    expect(ci).toMatch(/^env:\n(?: {2}.*\n)* {2}TERMWRIGHT_RETRIES: '0'$/mu);
    expect(ci).toContain("TERMWRIGHT_REQUIRE_GO: '1'");
    expect(release).toContain("TERMWRIGHT_REQUIRE_GO: '1'");
    expect(ci).toContain("GOPROXY: 'https://proxy.golang.org'");
    expect(release).toContain("GOPROXY: 'https://proxy.golang.org'");
    for (const [workflow, jobId, testAnchor] of [
      [ci, 'build', '--project=go-integration'],
      [ci, 'windows-driver-native', '--project=go-integration'],
      [ci, 'conformance-posix', 'Run the conformance matrix'],
      [ci, 'conformance-windows', 'Run the conformance matrix'],
      [ci, 'examples', 'Run every public example without skips'],
      [release, 'verify', '--project=go-integration'],
    ]) {
      const job = workflowJobBlocks(workflow).find((block) => block.startsWith(`  ${jobId}:\n`));
      expect(job, `${jobId} must install the required Go toolchain`).toContain('actions/setup-go@');
      expect(job, `${jobId} must pin the Go toolchain`).toContain("go-version: '1.25'");
      expect(job, `${jobId} must materialise Go dependencies before tests`).toContain(
        'prepare-go-test-dependencies.mjs',
      );
      expect(job, `${jobId} must take every later Go command offline`).toContain(
        "echo 'GOPROXY=off'",
      );
      expect(job, `${jobId} must disable later checksum-network access`).toContain(
        "echo 'GOSUMDB=off'",
      );
      expect(job, `${jobId} must prohibit toolchain downloads during tests`).toContain(
        "echo 'GOTOOLCHAIN=local'",
      );
      expect(job, `${jobId} must update the environment atomically`).toContain(
        '} >> "$GITHUB_ENV"',
      );
      expect(job.indexOf('prepare-go-test-dependencies.mjs')).toBeLessThan(job.indexOf(testAnchor));
    }
    const goCiJobs = Object.fromEntries(
      workflowJobBlocks(ci).map((job) => [job.match(/^ {2}([^:]+):/u)?.[1], job]),
    );
    expect(goCiJobs.clients).toContain('Materialise the checksum-pinned Go client graph');
    expect(goCiJobs.clients).toContain('go list -mod=readonly -deps -test ./...');
    expect(goCiJobs.clients).not.toMatch(/^\s+go mod download all$/mu);
    expect(goCiJobs.clients.indexOf('go list -mod=readonly -deps -test ./...')).toBeLessThan(
      goCiJobs.clients.indexOf("echo 'GOPROXY=off'"),
    );
    expect(goCiJobs.clients.indexOf("echo 'GOPROXY=off'")).toBeLessThan(
      goCiJobs.clients.indexOf('go test -race -count=1 ./...'),
    );
    expect(goCiJobs.clients).toContain("echo 'GOPROXY=off'");
    expect(goCiJobs.clients).toContain('} >> "$GITHUB_ENV"');
    expect(goCiJobs['release-hygiene']).toContain(
      'Materialise actionlint before the hygiene lane goes offline',
    );
    expect(goCiJobs['release-hygiene']).toContain("echo 'GOPROXY=off'");
    expect(goCiJobs['release-hygiene']).toContain('} >> "$GITHUB_ENV"');
    const goPreflight = await import('./prepare-go-test-dependencies.mjs');
    expect(goPreflight.GO_TEST_MODULES).toEqual([
      'clients/go',
      'packages/probe-charm/src/testing/fixture-v1-bubbles',
      'packages/probe-charm/src/testing/fixture-bubbles',
    ]);
    expect(goPreflight.UPSTREAM_BUILD_MODULES).toEqual([
      'github.com/charmbracelet/bubbletea@v1.3.9',
      'github.com/charmbracelet/bubbletea@v1.3.10',
      'charm.land/bubbletea/v2@v2.0.8',
      'charm.land/bubbletea/v2@v2.0.9',
      'github.com/charmbracelet/bubbles@v1.0.0',
      'charm.land/bubbles/v2@v2.1.1',
      'charm.land/lipgloss/v2@v2.0.6',
    ]);
    expect(goPreflight.BUBBLES_PACKAGE_PROBES).toEqual({
      'packages/probe-charm/src/testing/fixture-v1-bubbles': [
        'github.com/charmbracelet/bubbles/filepicker',
        'github.com/charmbracelet/bubbles/list',
        'github.com/charmbracelet/bubbles/progress',
        'github.com/charmbracelet/bubbles/spinner',
        'github.com/charmbracelet/bubbles/table',
      ],
      'packages/probe-charm/src/testing/fixture-bubbles': [
        'charm.land/bubbles/v2/filepicker',
        'charm.land/bubbles/v2/list',
        'charm.land/bubbles/v2/progress',
        'charm.land/bubbles/v2/spinner',
        'charm.land/bubbles/v2/table',
      ],
    });
    expect(release).toMatch(/^env:\n {2}TERMWRIGHT_RETRIES: '0'$/mu);
    expect(release).toContain('git worktree add --detach "$orchestration"');
    expect(release).toContain('git hash-object "$materializer"');
    expect(release).toContain('git worktree remove "$orchestration"');
    expect(release).toContain('cp "$orchestration/packages/probe-charm/src/launch.test.ts"');
    expect(release).toContain('cp "$orchestration/packages/pty/src/index.test.ts"');
    expect(release).toContain('Restore the immutable release test tree before packing');
    expect(release).toMatch(/packages\/pty\/src\/index\.test\.ts; do/u);
    expect(ci.match(/pnpm --dir packages\/protocol pack/gu)).toHaveLength(
      ci.match(/pnpm --dir packages\/pty pack/gu)?.length ?? 0,
    );
    for (const workflow of [ci, release, reliability]) {
      expect(workflow).toContain("TERMWRIGHT_REQUIRE_FIRST_WORKFLOW_ATTEMPT: '1'");
    }
    const upstream = await readFile(
      new URL('../.github/workflows/upstream-candidates.yml', import.meta.url),
      'utf8',
    );
    expect(upstream).toMatch(/^  GOTOOLCHAIN: local$/mu);
    expect(upstream).toMatch(/^  TERMWRIGHT_UPSTREAM_GO_VERSION: '1\.25'$/mu);
    const upstreamJobs = Object.fromEntries(
      workflowJobBlocks(upstream).map((job) => [job.match(/^ {2}([^:]+):/u)?.[1], job]),
    );
    for (const jobId of ['discovery', 'certify']) {
      expect(
        upstreamJobs[jobId],
        `${jobId} must use the Go floor required by monitored Bubble Tea releases`,
      ).toContain('go-version: ${{ env.TERMWRIGHT_UPSTREAM_GO_VERSION }}');
    }
    const vitestReliability = await readFile(
      new URL('../.github/workflows/vitest-reliability.yml', import.meta.url),
      'utf8',
    );
    for (const [name, workflow] of [
      ['CI', ci],
      ['Release', release],
      ['nightly reliability', reliability],
      ['Vitest reliability', vitestReliability],
      ['upstream certification', upstream],
    ]) {
      expect(workflow, `${name} must reject snapshot generation`).toContain(
        "TERMWRIGHT_UPDATE_SNAPSHOTS: 'none'",
      );
      const jobs = workflowJobBlocks(workflow);
      expect(jobs.length, `${name} must contain certification jobs`).toBeGreaterThan(0);
      for (const job of jobs) {
        expect(job, `${name} job must reject reruns as its first step`).toMatch(
          /    steps:\n      - name: Reject workflow reruns\n        shell: bash\n        run: test "\$GITHUB_RUN_ATTEMPT" = 1/u,
        );
      }
    }
    expect(`${ci}\n${release}\n${reliability}\n${JSON.stringify(manifest.scripts)}`).not.toMatch(
      /--retry(?:=|\s)/u,
    );

    const ciJobs = Object.fromEntries(
      workflowJobBlocks(ci).map((job) => [job.match(/^ {2}([^:]+):/u)?.[1], job]),
    );
    expectArtifactStep(
      ciJobs['pty-native-build-x64'],
      'upload-artifact',
      'pty-addon-x64',
      'packages/pty-win32-x64',
    );
    expectArtifactStep(
      ciJobs['pty-native-build-arm64'],
      'upload-artifact',
      'pty-addon-arm64',
      'packages/pty-win32-arm64',
    );
    expect(ciJobs['pty-native-build-x64']).toContain('node scripts/check-prebuild.mjs win32 x64');
    expect(ciJobs['pty-native-build-arm64']).toContain(
      'node scripts/check-prebuild.mjs win32 arm64',
    );
    const x64Consumers = {
      'pty-native': 'packages/pty/build/Release',
      'pty-native-x64-on-arm64': 'packages/pty-win32-x64',
      'windows-driver-native': 'packages/pty-win32-x64',
      'windows-native-stress': 'packages/pty-win32-x64',
      'conformance-windows': 'packages/pty-win32-x64',
    };
    for (const [jobId, path] of Object.entries(x64Consumers)) {
      expectExactNeed(ciJobs[jobId], 'pty-native-build-x64');
      expectArtifactStep(ciJobs[jobId], 'download-artifact', 'pty-addon-x64', path);
    }
    expectExactNeed(ciJobs['pty-native-arm64'], 'pty-native-build-arm64');
    expectArtifactStep(
      ciJobs['pty-native-arm64'],
      'download-artifact',
      'pty-addon-arm64',
      'packages/pty-win32-arm64',
    );
    for (const jobId of ['pty-native', 'pty-native-arm64']) {
      expect(ciJobs[jobId]).toContain("bun-version: '1.4.0'");
      expect(ciJobs[jobId]).toContain("TERMWRIGHT_REQUIRE_BUN: '1'");
    }
    expect(ciJobs['pty-native-x64-on-arm64']).toContain(
      'bun-download-url: https://github.com/oven-sh/bun/releases/download/bun-v1.4.0/bun-windows-x64-baseline.zip',
    );
    expect(ciJobs['pty-native-x64-on-arm64']).toContain("TERMWRIGHT_REQUIRE_BUN: '1'");
    for (const jobId of ['pty-native-arm64', 'pty-native-x64-on-arm64', 'windows-driver-native']) {
      expect(ciJobs[jobId]).toContain('scripts/verify-windows-pty-verdict.mjs');
    }
    expect(ciJobs['conformance-posix'].match(/^    needs:.*$/gmu)).toBeNull();
    expect(ciJobs['conformance-posix']).toContain('os: [ubuntu-latest, macos-latest]');
    expect(ciJobs['conformance-windows']).toContain('name: conformance windows-latest');
    expect(ciJobs.opentui).toContain("bun-version: '1.4.0'");
    expect(ciJobs.opentui).not.toContain('bun-version: latest');
    expect(ciJobs['ui-browser']).toContain("compile-native-pty: 'true'");
    expect(ciJobs.build).toContain(
      'if [[ "${{ runner.os }}" == "Windows" ]]; then profile=windows-ci; fi',
    );
    const configuredProjectNames = rootConfig.test.projects.map((project) => project.test.name);
    const selectedProjectNames = certifiedProjectShards.flat();
    expect(new Set(selectedProjectNames).size).toBe(selectedProjectNames.length);
    expect([...selectedProjectNames].sort()).toEqual([...configuredProjectNames].sort());
    expect(certifiedProjectShards).toContainEqual(['go-integration']);
    const goIntegrationProject = rootConfig.test.projects.find(
      (project) => project.test.name === 'go-integration',
    );
    expect(goIntegrationProject?.test.include).toEqual([
      'packages/probe-charm/**/*.test.ts',
      'packages/probe-go/**/*.test.ts',
      'packages/probe-tview/**/*.test.ts',
      'scripts/**/*.go.test.mjs',
    ]);
    const coreProject = rootConfig.test.projects.find((project) => project.test.name === 'core');
    for (const packageName of ['probe-charm', 'probe-go', 'probe-tview']) {
      expect(coreProject?.test.exclude).toContain(`packages/${packageName}/**`);
    }
    expect(
      ciJobs.build.match(
        /^          pnpm test -- --resource-profile "\$profile" --json -- --project=.*$/gmu,
      ),
    ).toEqual(
      certifiedProjectShards.map(
        (projects) =>
          `          pnpm test -- --resource-profile "$profile" --json -- ${projectSelectorArguments(projects)}`,
      ),
    );
    expect(ciJobs.build).toMatch(
      /^      - name: Certify Darwin fast-exit tails outside unit callback deadlines\n        if: runner\.os == 'macOS'\n        run: pnpm test:darwin-fast-exit$/mu,
    );
    expect(manifest.scripts['test:darwin-fast-exit']).toBe(
      'node scripts/certify-darwin-fast-exit.mjs',
    );
    const darwinFastExitCertification = await readFile(
      new URL('./certify-darwin-fast-exit.mjs', import.meta.url),
      'utf8',
    );
    expect(darwinFastExitCertification).toContain('const WAVES = 32;');
    expect(darwinFastExitCertification).toContain('const WAVE_WATCHDOG_MS = 5_000;');
    expect(darwinFastExitCertification).not.toMatch(/retry|sleep/u);
    expect(ciJobs.build).toMatch(
      /^      - name: Certify the injected tview screen lifecycle under the race detector\n        if: runner\.os != 'Windows'\n        run: pnpm test:tview-race$/mu,
    );
    expect(manifest.scripts['test:tview-race']).toBe('node scripts/certify-tview-screen-race.mjs');
    const tviewRaceCertification = await readFile(
      new URL('./certify-tview-screen-race.mjs', import.meta.url),
      'utf8',
    );
    expect(tviewRaceCertification).toContain('prepareInstrumentedBuild({');
    expect(tviewRaceCertification).toMatch(
      /\[\s*['"]build['"]\s*,\s*\.\.\.prepared\.goArgs\s*,\s*['"]-o['"]\s*,\s*binary\s*,\s*['"]\.['"]\s*,?\s*\]/u,
    );
    expect(tviewRaceCertification).toContain('launchTerminal({');
    expect(tviewRaceCertification).toContain('await waitForPairedSemanticRevision(terminal, 1)');
    expect(tviewRaceCertification).toMatch(
      /terminal\.getByRole\(['"]list['"]\s*,\s*\{\s*name:\s*['"]Files['"]\s*\}\)\.count\(\)/u,
    );
    expect(tviewRaceCertification).toMatch(
      /terminal\.getByRole\(['"]button['"]\s*,\s*\{\s*name:\s*['"]Save['"]\s*\}\)\.count\(\)/u,
    );
    expect(tviewRaceCertification).toContain('`log_path=${raceLogPrefix}`');
    expect(tviewRaceCertification).toContain("'halt_on_error=1'");
    expect(tviewRaceCertification).toContain("'exitcode=66'");
    expect(tviewRaceCertification).toContain(
      'const raceReports = await readRaceReports(raceLogPrefix);',
    );
    expect(
      tviewRaceCertification.indexOf('const raceReports = await readRaceReports'),
    ).toBeGreaterThan(tviewRaceCertification.indexOf('const exit = await terminal.waitForExit()'));
    expect(tviewRaceCertification).toContain('exit.code === 0 && raceReports.length === 0');
    expect(tviewRaceCertification).toContain('...raceReports');
    expect(tviewRaceCertification).toContain(
      "raceReports.length === 0 ? terminal.screen().text() : ''",
    );
    for (const jobId of ['build', 'windows-driver-native']) {
      expect(ciJobs[jobId]).toMatch(
        /^      - name: Certify the Go compiler injection contract\n        run: pnpm test:go-toolexec$/mu,
      );
      expect(ciJobs[jobId]).toMatch(
        /^      - name: Certify the real Git handoff contract\n        run: pnpm test:manual-handoff$/mu,
      );
      expect(ciJobs[jobId].indexOf('test:manual-handoff')).toBeLessThan(
        ciJobs[jobId].indexOf('- run: pnpm build'),
      );
    }
    expect(ciJobs.build).toContain('os: [ubuntu-22.04, macos-latest]');
    expect(ciJobs.build).toContain("node: ['22', '24']");
    expect(ciJobs['windows-driver-native']).toContain("node: ['22', '24']");
    expect(ciJobs.clients).not.toContain('test:go-toolexec');
    expect(manifest.scripts['test:go-toolexec']).toBe(
      'pnpm --filter @termwright/probe-go run build && node scripts/certify-go-toolexec.mjs',
    );
    const certificationNeeds = [
      ...(ciJobs.certification ?? '').matchAll(/^      - ([a-z0-9-]+)$/gmu),
    ].map((match) => match[1]);
    expect(certificationNeeds).toEqual(
      Object.keys(ciJobs).filter((jobId) => jobId !== 'certification'),
    );
    expect(ciJobs.certification).toContain('if: always()');
    expect(ciJobs.certification).toContain('select(.value.result != "success")');
    expect(ciJobs['resource-leak']).toContain('--detectAsyncLeaks');
    expect(ciJobs['resource-leak']).toContain('packages/probe-ink/src/render-boundary.test.ts');
    expect(ciJobs['resource-leak']).toContain('packages/desktop-host/src/deadline.test.ts');
    expect(ciJobs['resource-leak']).toContain('packages/driver/src/session-lifecycle.test.ts');
    expect(ciJobs['resource-leak']).toContain(
      'packages/driver/src/internal/session-process-lifecycle.test.ts',
    );
    expect(ciJobs['resource-leak']).toContain(
      'packages/driver/src/internal/resource-scope.test.ts',
    );
    expect(ciJobs['resource-leak']).toContain('packages/driver/src/internal/action-retry.test.ts');
    expect(ciJobs['resource-leak']).toContain('packages/mcp/src/sessions.test.ts');
    expect(ciJobs.determinism).toContain('packages/probe-ink/src/render-boundary.test.ts');
    expect(ciJobs.determinism).toContain('packages/probe-ink/src/render-boundary-ink.test.ts');
    expect(ciJobs.determinism).toContain('packages/ink/src/fixture-rerender.test.ts');
    expect(ciJobs['windows-driver-native'].indexOf('actions/download-artifact@')).toBeLessThan(
      ciJobs['windows-driver-native'].indexOf('- run: pnpm build'),
    );

    const reliabilityJobs = Object.fromEntries(
      workflowJobBlocks(reliability).map((job) => [job.match(/^ {2}([^:]+):/u)?.[1], job]),
    );
    expect(reliabilityJobs['nightly-soak-posix'].match(/^    needs:.*$/gmu)).toBeNull();
    expectExactNeed(reliabilityJobs['nightly-soak-windows'], 'pty-native-build-x64');
    const windowsSoak = reliabilityJobs['nightly-soak-windows'];
    expect(windowsSoak.indexOf('actions/download-artifact@')).toBeLessThan(
      windowsSoak.indexOf('- run: pnpm build'),
    );
    expect(vitestReliability).toContain('node scripts/run-vitest-pty-matrix.mjs');
    expectArtifactStep(
      reliabilityJobs['pty-native-build-x64'],
      'upload-artifact',
      'nightly-pty-addon-x64',
      'packages/pty-win32-x64',
    );
    expectArtifactStep(
      reliabilityJobs['nightly-soak-windows'],
      'download-artifact',
      'nightly-pty-addon-x64',
      'packages/pty-win32-x64',
    );
    expect(reliabilityJobs['pty-native-build-x64']).toContain(
      'node scripts/check-prebuild.mjs win32 x64',
    );
    expect(reliabilityJobs['nightly-soak-windows']).toContain(
      'node scripts/check-prebuild.mjs win32 x64',
    );
    expect(reliabilityJobs['nightly-soak-windows']).toContain('resource-profile windows-ci');

    const releaseJobs = Object.fromEntries(
      workflowJobBlocks(release).map((job) => [job.match(/^ {2}([^:]+):/u)?.[1], job]),
    );
    const ptyPrebuildAction = await readFile(
      new URL('../.github/actions/build-pty-prebuild/action.yml', import.meta.url),
      'utf8',
    );
    expect(
      releaseJobs.verify.match(
        /^          pnpm test -- --resource-profile ci --json -- --project=.*$/gmu,
      ),
    ).toEqual(
      certifiedProjectShards.map(
        (projects) =>
          `          pnpm test -- --resource-profile ci --json -- ${projectSelectorArguments(projects)}`,
      ),
    );
    expect(releaseJobs.verify).toMatch(/^        run: pnpm test:tview-race$/mu);
    expect(releaseJobs.verify).toMatch(/^        run: pnpm test:go-toolexec$/mu);
    expect(releaseJobs.prebuilds).toContain('uses: ./.github/actions/build-pty-prebuild');
    expect(releaseJobs.prebuilds).toContain('platform: ${{ matrix.platform }}');
    expect(releaseJobs.prebuilds).toContain('architecture: ${{ matrix.arch }}');
    expect(ptyPrebuildAction).toContain('node-gyp install --ensure --target="$node_version"');
    expect(ptyPrebuildAction).toContain(
      'node-gyp rebuild --target="$node_version" --arch=${{ inputs.architecture }}',
    );
    expect(ptyPrebuildAction).toContain('--nodedir="$node_root"');
    expectCommandBefore(
      ptyPrebuildAction,
      'pnpm --filter @termwright/protocol build',
      'pnpm --filter @termwright/pty build',
    );
    expect(ptyPrebuildAction).toContain(
      'pnpm --dir packages/protocol pack --pack-destination "$pack_dir"',
    );
    expect(ptyPrebuildAction).toContain('node scripts/check-installed-pty.mjs "$install_dir"');
    expect(ptyPrebuildAction).toContain('scripts/verify-windows-pty-verdict.mjs');
    expect(releaseJobs.prebuilds).toContain("bun-version: '1.4.0'");
    expect(releaseJobs['certify-x64-on-arm64']).toContain('runs-on: windows-11-arm');
    expect(releaseJobs['certify-x64-on-arm64']).toContain('architecture: x64');
    expect(releaseJobs['certify-x64-on-arm64']).toContain('bun-windows-x64.zip');
    expect(releaseJobs['certify-x64-on-arm64']).toContain(
      'pnpm --dir packages/protocol pack --pack-destination "$pack_dir"',
    );
    expectCommandBefore(
      releaseJobs['certify-x64-on-arm64'],
      'pnpm --filter @termwright/protocol build',
      'pnpm --filter @termwright/pty build',
    );
    expect(releaseJobs['certify-x64-on-arm64']).toContain('certification-verdict-arm64-host.json');
    expect(releaseJobs.verify).toContain('scripts/verify-windows-pty-verdict.mjs');
    expect(releaseJobs.verify).toContain('certification-verdict-arm64-host.json');
    const previewJobs = Object.fromEntries(
      workflowJobBlocks(preview).map((job) => [job.match(/^ {2}([^:]+):/u)?.[1], job]),
    );
    expect(previewJobs.prebuilds).toContain("bun-version: '1.4.0'");
    expect(previewJobs.prebuilds).toContain('uses: ./.github/actions/build-pty-prebuild');
    expect(previewJobs['certify-x64-on-arm64']).toContain('runs-on: windows-11-arm');
    expect(previewJobs['certify-x64-on-arm64']).toContain('bun-windows-x64.zip');
    expect(previewJobs['certify-x64-on-arm64']).toContain(
      'pnpm --dir packages/protocol pack --pack-destination "$pack_dir"',
    );
    expectCommandBefore(
      previewJobs['certify-x64-on-arm64'],
      'pnpm --filter @termwright/protocol build',
      'pnpm --filter @termwright/pty build',
    );
    expect(previewJobs['certify-x64-on-arm64']).toContain('certification-verdict-arm64-host.json');
    expect(previewJobs.preview).toContain('scripts/verify-windows-pty-verdict.mjs');
    expect(previewJobs.preview).toContain('certification-verdict-arm64-host.json');
    expect(releaseJobs.prebuilds).toContain('runner: ubuntu-22.04 }');
    expect(releaseJobs.prebuilds).toContain('runner: ubuntu-22.04-arm }');
    expect(releaseJobs.prebuilds).toContain("macos_target: '13.5'");
    expect(releaseJobs.prebuilds).toContain('macos-deployment-target: ${{ matrix.macos_target }}');
    expect(ptyPrebuildAction).toContain(
      'MACOSX_DEPLOYMENT_TARGET: ${{ inputs.macos-deployment-target }}',
    );
    expect(releaseJobs.prebuilds).not.toMatch(/^\s+CXX:/mu);
    const setupWorkspace = await readFile(
      new URL('../.github/actions/setup-js-workspace/action.yml', import.meta.url),
      'utf8',
    );
    expect(setupWorkspace).not.toMatch(/^\s+CXX:/mu);
    expect(
      await readFile(new URL('../packages/pty/binding.gyp', import.meta.url), 'utf8'),
    ).toContain('"MACOSX_DEPLOYMENT_TARGET": "13.5"');
    expect(releaseJobs.verify).toContain('node scripts/check-prebuild.mjs --all');

    const configFiles = ['vitest.config.ts'];
    for (const directory of ['packages', 'examples', 'quality']) {
      await collectVitestConfigs(directory, configFiles);
    }
    for (const file of configFiles) {
      const source = await readFile(new URL(`../${file}`, import.meta.url), 'utf8');
      for (const match of source.matchAll(/\bretry\s*:\s*([^,\n}]+)/gu)) {
        expect(match[1]?.trim(), `${file} must not enable test retry`).toBe('0');
      }
    }

    for (const directory of ['packages', 'examples', 'clients']) {
      const entries = await readdir(new URL(`../${directory}/`, import.meta.url), {
        withFileTypes: true,
      });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        try {
          const workspaceManifest = JSON.parse(
            await readFile(
              new URL(`../${directory}/${entry.name}/package.json`, import.meta.url),
              'utf8',
            ),
          );
          expect(
            JSON.stringify(workspaceManifest.scripts ?? {}),
            `${directory}/${entry.name}/package.json must not enable retry`,
          ).not.toMatch(/--retry(?:=|\s)/u);
        } catch (error) {
          if (error?.code !== 'ENOENT') throw error;
        }
      }
    }

    const testSources = [];
    await collectTestSources('packages', testSources);
    const goBackedTests = new Set([
      'packages/probe-charm/src/detect.test.ts',
      'packages/probe-charm/src/launch.test.ts',
      'packages/probe-charm/src/patch-sets.test.ts',
      'packages/probe-charm/src/zero-config.pty.test.ts',
      'packages/probe-go/src/workspace.test.ts',
      'packages/probe-tview/src/zero-config.pty.test.ts',
    ]);
    for (const file of testSources) {
      const source = await readFile(new URL(`../${file}`, import.meta.url), 'utf8');
      expect(source, `${file} must not implement a private Go skip policy`).not.toContain(
        'TERMWRIGHT_SKIP_GO',
      );
      if (
        goBackedTests.has(file) ||
        /\b(?:execFile|spawnSync|run)\s*\(\s*['"]go['"]|\bensureUpstreamModule\s*\(/u.test(source)
      ) {
        expect(source, `${file} must import the centralized fail-closed Go probe`).toContain(
          'test-support/go-toolchain.mjs',
        );
        expect(source, `${file} must call the centralized fail-closed Go probe`).toContain(
          'goTestCapability(',
        );
      }
    }
    const goPolicy = await readFile(
      new URL('./test-support/go-toolchain.mjs', import.meta.url),
      'utf8',
    );
    expect(goPolicy).toContain("env['TERMWRIGHT_SKIP_GO'] === '1'");
    expect(goPolicy).toContain("env['TERMWRIGHT_REQUIRE_GO'] === '1'");
    const goToolExecTests = await readFile(
      new URL('../packages/probe-go/src/toolexec.test.ts', import.meta.url),
      'utf8',
    );
    expect(goToolExecTests).not.toContain('prepareGoToolExec');
    expect(goToolExecTests).not.toMatch(/\b(?:execFile|spawnSync|run)\s*\(/u);
    const goToolExecCertification = await readFile(
      new URL('./certify-go-toolexec.mjs', import.meta.url),
      'utf8',
    );
    expect(goToolExecCertification).toContain('await prepareGoToolExec({');
    expect(goToolExecCertification).toContain('candidate client replacement transaction');
    expect(goToolExecCertification).toContain('bindLocalTermwrightGoClient(');
    expect(goToolExecCertification).toContain('warm-cache owned source tamper refusal');
    expect(goToolExecCertification).toContain('vendor-mode dependency selection');
    expect(goToolExecCertification).toContain('compiler identity includes imported archives');
    expect(goToolExecCertification).toMatch(
      /\[\s*['"]test['"]\s*,\s*['"]-vet=off['"]\s*,\s*['"]-count=1['"]\s*,\s*['"]-run['"]\s*,\s*['"]\^TestProbe\$['"]\s*,\s*\.\.\.prepared\.goArgs\s*,\s*['"]\.['"]\s*,?\s*\]/u,
    );

    const workflows = (await readdir(new URL('../.github/workflows/', import.meta.url))).filter(
      (file) => /\.ya?ml$/u.test(file),
    );
    for (const file of workflows) {
      const source = await readFile(
        new URL(`../.github/workflows/${file}`, import.meta.url),
        'utf8',
      );
      for (const job of workflowJobBlocks(source)) {
        expect(job, `${file} job must reject reruns as its first step`).toMatch(
          /    steps:\n      - name: Reject workflow reruns\n        shell: bash\n        run: test "\$GITHUB_RUN_ATTEMPT" = 1/u,
        );
      }
      expect(source, `${file} must not retry tests or failed jobs`).not.toMatch(
        /--retry(?:=|\s)|rerun-failed-jobs|\bgh run rerun\b/u,
      );
    }
  });

  it('keeps root test and watch commands on the native host', async () => {
    const manifest = JSON.parse(
      await readFile(new URL('../package.json', import.meta.url), 'utf8'),
    );
    expect(manifest.scripts.test).toContain('termwright-cli/dist/bin.js test');
    expect(manifest.scripts['test:watch']).toContain('termwright-cli/dist/bin.js watch');
    expect(`${manifest.scripts.test}\n${manifest.scripts['test:watch']}`).not.toMatch(
      /(?:^|\s)vitest(?:\s|$)/u,
    );
  });

  it('keeps Bun availability in one fail-closed capability policy without inverse tests', async () => {
    const policy = await readFile(
      new URL('./test-support/bun-runtime.mjs', import.meta.url),
      'utf8',
    );
    expect(policy).toContain("env['TERMWRIGHT_SKIP_BUN'] === '1'");
    expect(policy).toContain("env['TERMWRIGHT_REQUIRE_BUN'] === '1'");

    for (const file of [
      'packages/probe-ink/src/zero-config.test.ts',
      'packages/probe-opentui/src/testing/bun-available.ts',
      'packages/pty/src/windows-native.win.test.ts',
    ]) {
      const source = await readFile(new URL(`../${file}`, import.meta.url), 'utf8');
      expect(source, file).toContain('test-support/bun-runtime.mjs');
      expect(source, file).toContain('bunTestCapability(');
    }

    const opentuiTests = await Promise.all([
      readFile(new URL('../packages/probe-opentui/src/injection.test.ts', import.meta.url), 'utf8'),
      readFile(
        new URL('../packages/probe-opentui/src/zero-config.test.ts', import.meta.url),
        'utf8',
      ),
    ]);
    expect(opentuiTests.join('\n')).not.toMatch(
      /skips the Bun arms|coverage note|no bun binary is reachable/u,
    );
  });

  it('keeps shared workspace build outputs immutable after the native host starts', async () => {
    const rootManifest = JSON.parse(
      await readFile(new URL('../package.json', import.meta.url), 'utf8'),
    );
    const pretest = await readFile(new URL('./ensure-test-host.mjs', import.meta.url), 'utf8');
    expect(rootManifest.scripts.build).toContain('immutable-build-manifest.mjs --write');
    expect(pretest).toContain('verifyImmutableWorkspaceBuild()');
    const workflowFiles = (await readdir(new URL('../.github/workflows/', import.meta.url))).filter(
      (file) => file.endsWith('.yml'),
    );
    for (const file of workflowFiles) {
      const source = await readFile(
        new URL(`../.github/workflows/${file}`, import.meta.url),
        'utf8',
      );
      expect(source, `${file} must not bypass the post-build fingerprint`).not.toContain(
        "pnpm -r --filter './packages/*' run build",
      );
    }
    const consumers = [
      'packages/probe-ink/src/zero-config.test.ts',
      'packages/probe-opentui/src/injection.test.ts',
      'packages/probe-opentui/src/zero-config.test.ts',
    ];
    for (const file of consumers) {
      const source = await readFile(new URL(`../${file}`, import.meta.url), 'utf8');
      expect(source, `${file} must validate prebuilt inputs`).toContain(
        'test-support/immutable-build-inputs.mjs',
      );
      expect(source, `${file} must not build shared dist from a test worker`).not.toMatch(
        /\b(?:exec|execFile|spawn|run)\s*\(\s*['"](?:npm|pnpm|yarn)['"][\s\S]{0,160}\bbuild\b/u,
      );
    }
  });

  it('keeps every package test script on the root native host', async () => {
    const entries = await readdir(new URL('../packages/', import.meta.url), {
      withFileTypes: true,
    });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      let manifest;
      try {
        manifest = JSON.parse(
          await readFile(
            new URL(`../packages/${entry.name}/package.json`, import.meta.url),
            'utf8',
          ),
        );
      } catch (error) {
        if (error?.code === 'ENOENT') continue;
        throw error;
      }
      const command = manifest.scripts?.test;
      if (command === undefined) continue;
      expect(command, entry.name).not.toMatch(/--retry(?:=|\s)/u);
      expect(command, entry.name).not.toMatch(/(?:^|\s)vitest(?:\s|$)/u);
      expect(command, entry.name).toMatch(
        /(?:termwright-cli\/dist\/bin\.js test|pnpm --dir \.\.\/\.\. test)/u,
      );
      for (const dependencies of [
        manifest.dependencies,
        manifest.devDependencies,
        manifest.peerDependencies,
      ]) {
        if (dependencies?.vitest !== undefined)
          expect(dependencies.vitest, `${entry.name} Vitest range`).toBe('4.1.11');
      }
    }
  });

  it('does not let conformance resurrect a reporter-parsing Vitest scheduler', async () => {
    const source = await readFile(
      new URL('../packages/conformance/scripts/conformance.mjs', import.meta.url),
      'utf8',
    );
    expect(source).toContain('TermwrightTestHost.open');
    expect(source).not.toMatch(/spawn|reporter=json|vitestEntry|VITEST/u);
  });

  it('requires Attempt admission for every repository-owned real PTY test', async () => {
    const testSources = [];
    await collectTestSources('packages', testSources);
    const directNative =
      /\b(?:spawnPty|spawnWindowsPty|launchTerminal|launchInkFixture)\s*\(|createNativePtyBackend\s*\(\s*\)\s*\.\s*spawn\s*\(/u;
    const indirectNative = new Set([
      'packages/conformance/src/suites/adversarial.test.ts',
      'packages/conformance/src/suites/driver-generic.test.ts',
      'packages/conformance/src/suites/interaction.test.ts',
      'packages/conformance/src/suites/mcp-sessions.test.ts',
      'packages/conformance/src/suites/ready.test.ts',
      'packages/mcp/src/server.test.ts',
    ]);

    for (const file of testSources) {
      const source = await readFile(new URL(`../${file}`, import.meta.url), 'utf8');
      if (!directNative.test(source) && !indirectNative.has(file)) continue;
      expect(source, `${file} must use the resource-aware Vitest declaration API`).toMatch(
        /from ['"](?:@termwright\/test-provider-internal|@termwright\/test)['"]/u,
      );
      expect(source, `${file} must not restore the removed broker/Vitest boundary`).not.toContain(
        '@termwright/resource-broker/vitest',
      );
      expect(source, `${file} must declare its complete live terminal group`).toMatch(
        /\.resources\s*\(\s*\{[\s\S]*?terminals\s*:/u,
      );
    }

    const adapterSuite = await readFile(
      new URL('../packages/conformance/src/adapter-conformance.ts', import.meta.url),
      'utf8',
    );
    expect(adapterSuite).toMatch(
      /resourceAwareIt\.resources\(\{\s*terminals:\s*1,\s*traceWriters:\s*0\s*\}\)/u,
    );
    expect(adapterSuite).not.toContain('requires?.prepare');
    expect(adapterSuite).not.toMatch(/beforeAll\s*\([\s\S]{0,500}AdapterProbe\.start/u);

    const languageAdapters = await readFile(
      new URL('../packages/conformance/src/suites/language-adapters.test.ts', import.meta.url),
      'utf8',
    );
    expect(languageAdapters).toContain(
      'probe: [process.execPath, GO_VERIFY, GO_CONTRACT, GO_BINARY, GO_BASELINE]',
    );
    expect(languageAdapters).not.toContain('build-tview-fixture.mjs');
    const conformanceSource = await readFile(
      new URL('../packages/conformance/scripts/conformance.mjs', import.meta.url),
      'utf8',
    );
    expect(conformanceSource.indexOf('await buildTviewFixture()')).toBeLessThan(
      conformanceSource.indexOf('TermwrightTestHost.open'),
    );
    expect(conformanceSource).toContain('const teardownFailures = []');
    expect(conformanceSource).toContain('await tviewFixture.cleanup()');

    const pressureSources = await Promise.all([
      readFile(new URL('../packages/pty/src/index.test.ts', import.meta.url), 'utf8'),
      readFile(new URL('../packages/pty/src/windows-native.win.test.ts', import.meta.url), 'utf8'),
      readFile(new URL('../packages/driver/src/escapes.pty.test.ts', import.meta.url), 'utf8'),
      readFile(
        new URL('../packages/driver/src/process-lifecycle.pty.test.ts', import.meta.url),
        'utf8',
      ),
      readFile(
        new URL('../packages/conformance/src/suites/adversarial.test.ts', import.meta.url),
        'utf8',
      ),
    ]);
    for (const source of pressureSources)
      expect(source).toMatch(/nativeHost:\s*["']exclusive["']/u);

    const candidateUnit = await readFile(
      new URL('./certify-framework-candidate.test.mjs', import.meta.url),
      'utf8',
    );
    expect(candidateUnit).toContain('in one toolchain transaction');
    expect(candidateUnit).not.toMatch(/exec\(['"]go['"]/u);

    const hostPressureUnits = await Promise.all(
      [
        './aggregate-framework-candidate-verdicts.test.mjs',
        './certify-framework-candidate.test.mjs',
        './certify-upstream-patches.test.mjs',
        './check-npm-release-readiness.test.mjs',
        './check-prebuild.test.mjs',
        './compare-paired-performance.test.mjs',
        './conformance-tview-fixture.test.mjs',
        './discover-framework-candidates.test.mjs',
        './package-subpath-exports.test.mjs',
        './performance-harness-fingerprint.test.mjs',
        './test-support/immutable-build-inputs.test.mjs',
      ].map((path) => readFile(new URL(path, import.meta.url), 'utf8')),
    );
    for (const source of hostPressureUnits) {
      expect(source).toMatch(
        /const it = resourceAwareIt\.resources\(\{\s*hostPressure:\s*['"]exclusive['"]\s*\}\)/u,
      );
      expect(source).not.toMatch(/import\s*\{[^}]*\bit\b[^}]*\}\s*from\s*['"]vitest['"]/u);
    }

    const handoffTest = await readFile(
      new URL('./create-manual-compatibility-handoff.test.mjs', import.meta.url),
      'utf8',
    );
    expect(handoffTest).toMatch(
      /resourceAwareIt\.resources\(\{\s*hostPressure:\s*['"]exclusive['"]\s*\}\)/u,
    );
    expect(handoffTest).toContain('signal: controller.signal');
    expect(handoffTest).toContain("context.signal.addEventListener('abort', abortFromTest");
    expect(handoffTest).toContain('context.onTestFinished(async () =>');
    expect(handoffTest).toContain('createOwnedExecFile(process.execPath');
    expect(handoffTest).not.toContain("new URL('./create-manual-compatibility-handoff.mjs'");

    const npmArchiveTest = await readFile(
      new URL('./pack-npm-artifacts.test.mjs', import.meta.url),
      'utf8',
    );
    expect(npmArchiveTest).not.toContain('node:child_process');
    expect(npmArchiveTest).not.toMatch(/execFileSync\(['"]tar['"]/u);
    const npmPacking = await readFile(new URL('./pack-npm-artifacts.mjs', import.meta.url), 'utf8');
    expect(npmPacking).toContain('inspectSafeTarGz(');
    expect(npmPacking).not.toMatch(/execFileSync\(['"]tar['"]/u);

    const availability = await readFile(
      new URL('../packages/test/src/pty-available.ts', import.meta.url),
      'utf8',
    );
    expect(availability).toContain('nativePtyAvailable()');
    expect(
      availability,
      'collection-time availability must never create an unadmitted child',
    ).not.toMatch(/createNativePtyBackend|\.spawn\s*\(|spawnPty|spawnWindowsPty/u);
  });
});
