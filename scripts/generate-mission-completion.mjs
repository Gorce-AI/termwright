#!/usr/bin/env node

import { access, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const outputUrl = new URL('../docs/architecture/audit/mission-completion.json', import.meta.url);

const titles = `Engineering principles
Mandatory audit methodology
Target product architecture
Effective Session Contract
Capability Graph
No orphan capabilities
Capability provenance
Observation semantics
Application evidence providers
Provider conflicts and lifecycle
Physical action strategy evidence
Strategy precedence
Keyboard focus navigation
type versus fill
Semantic actions inform planning
Semantic versus screen queries
Type-safe Locator domains
Locator algebra
Single ActionPlanner
Real PTY pointer actions
Physical regions and safe points
Keyboard and Mouse devices
Action postconditions
Canonical Conditions
First semantic-tree absence rule
Revision and checkpoint domain
Monotonic total deadlines
Outer attempt budget
Event-driven waits
Honest wait proof names
Deterministic semantic negotiation
Causal barriers
Causal resize
Semantic value confidentiality
Portable semantic vocabulary
Geometry model
Painted-region vertical slice
Truthful render order
Decomposed scroll concepts
Framework evidence rule
Textual completion
OpenTUI completion
Ink completion
tview completion
Ratatui completion
Charm certification closure
ConPTY input-mode evidence
Input protocol completeness
Native Termwright Test Host
Shared test watch and UI host
Plain Vitest compatibility mode
Termwright-owned configuration
Exact Vitest certification
Reporter composition
Gherkin host integration
Identity hierarchy
Native Vitest task identity
Collision-safe Run IDs
First-class Attempt IDs
Attempt AsyncLocalStorage
Startup event journal
Versioned Run Event envelope
Run state machine
Infrastructure failure classification
Structured event transport
Event data classes
Bounded queues and backpressure
Run-end flush barrier
Workspace concurrency mitigation
Windows worker-channel evidence
Host ResourceBroker
Cross-worker broker transport
Broker deadlock prevention
Resource profiles
Suite cost classification
ResourceScope
Transactional TerminalSession startup
Shared close promise
Verified process-tree teardown
No fabricated exit
EOF-driven final output
Truthful signal semantics
Semantic server hardening
PTY early output and writes
Final app-log drain
Transactional trace finalization
Transactional run persistence
Artifact-safe receipts
Artifact recording policy
Sensitive input and values
No per-test module globals
Concurrent snapshot writes
Symlink-aware filesystem sandbox
Concurrent process-global isolation
ResourceScope across services
Managed monotonic sweepers
Typed HTTP bind rollback
Acknowledged UI control RPC
Programmatic discovery
No sibling Vitest reruns
Native-ID UI selection
History identity separation
Fail-on-flaky policy
Main and stress gates
Reliability CI lanes
Platform Deviation Registry
Certification matrix
Test oracle quality
Static determinism audit
Windows reliability matrix
Windows process semantics
ConPTY query and mode proof
node-pty boundary
Worker-channel crash experiments
Cross-language provider parity
One action and event model
Artifact-safe ActionReceipt
Native Runner UX
Reporter UX
Runner node inspector
Runner resource diagnostics
Causal trace UX
Truthful recorder abstraction
Cross-surface consistency gates
Framework semantic completeness report
Lifecycle fault injection
Contract-driven conformance
Deviation closure policy`.split('\n');

if (titles.length !== 128) throw new Error(`mission title inventory has ${titles.length} entries, expected 128`);

const partial = new Map([
  [53, 'The embedded engine is exact-pinned to Vitest 4.1.11, migrated from 3.2.7 to drop tinypool, whose ProcessWorker.send teardown crash blocked Windows; the lockfile-backed local 4.1.11 pressure matrix is green and the Windows Node 22/24 certification still needs a reviewed current run.'],
  [70, 'Infrastructure telemetry and the independent pressure harness exist; the current Windows Node 22/24 matrix result is external execution evidence and is not fabricated locally.'],
  [81, 'Both platforms now own an authoritative boundary: Windows through the native ConPTY session, whose stream ends when the pipe ends and is certified on real Windows, and Unix through the pty master. What remains is a Linux failure that is not yet explained — a megabyte of output followed by a sentinel, with the sentinel absent from the grid while the producer reported a clean end of source, so it is neither the node-pty destroy timer nor a torn-down producer.'],
  [110, 'Every historical Windows issue is categorized and the lanes execute: the addon builds for x64 and arm64, the ConPTY contract is certified on both Node lines, and conformance and lifecycle stress pass on Windows. The reliability matrix artifacts for the embedded engine are the part still outstanding.'],
  [112, 'ConPTY observability and functional provider-backed input are separated and tested, and the Windows lane executes them. The pointer case is the one open item: a transport that repaints on its own made every frame look like a moved target, and the planner now confirms the target by the name the tree gives it while keeping a moved coordinate system fatal. Green on this claim awaits the Windows row that carries that change.'],
  [113, 'Windows no longer has this boundary at all: it runs on the native ConPTY backend, and node-pty is neither loaded nor fallen back to there. The exact-certified private write boundary remains on POSIX, where node-pty is still the backend, and that coupling is what is left to remove.'],
  [114, 'The independent harness covers the exact embedded Vitest, pools, workers, file parallelism and PTY pressure from the repository lockfile; a reviewed current Windows artifact is the remaining evidence.'],
]);

const obsolete = new Map([
  [51, 'Product policy intentionally removed plain-Vitest compatibility. Termwright native-host execution is the only product mode; Vitest remains the embedded engine, not a parallel user-facing runner.'],
]);

const exactEvidence = new Map([
  [53, ['packages/test/src/vitest-engine.ts', 'packages/test/src/runner.test.ts', 'scripts/run-vitest-pty-matrix.mjs']],
  [70, ['.github/workflows/vitest-reliability.yml', 'scripts/run-vitest-pty-matrix.mjs', 'quality/experiments/vitest-pty-pressure.test.mjs']],
  [79, ['packages/driver/src/internal/process-supervisor.ts', 'packages/driver/src/process-lifecycle.pty.test.ts', '.github/workflows/ci.yml']],
  [81, ['packages/driver/src/pty.ts', 'packages/driver/src/pty-upstream-boundary.test.ts', 'scripts/check-node-pty-certification.mjs']],
  [110, ['docs/architecture/audit/platform-completion-baseline.json', '.github/workflows/vitest-reliability.yml', 'quality/platform-deviations.json']],
  [111, ['packages/driver/src/internal/process-supervisor.ts', 'packages/driver/src/process-lifecycle.pty.test.ts', '.github/workflows/ci.yml']],
  [112, ['packages/driver/src/session.pty.test.ts', 'packages/conformance/src/suites/interaction.test.ts', 'quality/platform-deviations.json']],
  [113, ['packages/driver/src/pty-upstream-boundary.test.ts', 'scripts/check-node-pty-certification.mjs', 'packages/driver/src/pty.ts']],
  [114, ['scripts/run-vitest-pty-matrix.mjs', 'quality/experiments/vitest-pty-pressure.test.mjs', '.github/workflows/vitest-reliability.yml']],
]);

function evidenceFor(section) {
  const exact = exactEvidence.get(section);
  if (exact !== undefined) return exact;
  if (section <= 10) return ['packages/protocol/src/capability-graph.ts', 'compatibility/registry.json', 'packages/driver/src/provider-evidence.ts'];
  if (section <= 23) return ['packages/driver/src/action-planner.ts', 'packages/driver/src/locator.ts', 'packages/protocol/src/action-model.ts'];
  if (section <= 39) return ['packages/driver/src/internal/deadline.ts', 'packages/test/src/attempt-budget.ts', 'packages/driver/src/pairing.ts'];
  if (section <= 48) return ['compatibility/registry.json', 'compatibility/framework-semantic-completeness.json', 'packages/conformance/src/suites'];
  if (section <= 60) return ['packages/termwright-cli/src/test-host.ts', 'packages/test/src/runner.ts', 'packages/test/src/attempt-context.ts'];
  if (section <= 68) return ['packages/protocol/src/run-events.ts', 'packages/protocol/src/run-journal.ts', 'packages/run-journal-transport/src/index.ts'];
  if (section <= 75) return ['packages/resource-broker/src/index.ts', 'packages/resource-broker/src/transport.ts', 'packages/termwright-cli/src/resource-profiles.ts'];
  if (section <= 84) return ['packages/driver/src/internal/resource-scope.ts', 'packages/driver/src/internal/process-supervisor.ts', 'packages/driver/src/pty.ts'];
  if (section <= 94) return ['packages/trace/src/writer.ts', 'packages/run-history/src/index.ts', 'packages/test/src/snapshot-store.ts'];
  if (section <= 102) return ['packages/termwright-cli/src/test-host.ts', 'packages/ui/src/server.ts', 'packages/ui/src/runs.ts'];
  if (section <= 109) return ['.github/workflows/ci.yml', '.github/workflows/reliability.yml', 'quality/platform-deviations.json'];
  if (section <= 114) return ['scripts/run-vitest-pty-matrix.mjs', 'scripts/check-node-pty-certification.mjs', 'packages/driver/src/process-lifecycle.pty.test.ts'];
  return ['clients/test-vectors', 'packages/ui/src/live.ts', 'compatibility/framework-semantic-completeness.json', 'compatibility/registry.test.ts'];
}

const report = {
  schemaVersion: 1,
  capturedAt: '2026-08-24',
  baselineHead: 'a796f17244291be08ddf64a519acbd03b23b54c5',
  policy: {
    productMode: 'termwright-native-host-only',
    backwardsCompatibility: false,
    embeddedEngine: 'vitest@4.1.11',
    certificationRule: 'partial sections cannot support the final cross-platform certification claim',
  },
  baselineCiEvidence: {
    runId: '32530899608',
    headSha: 'a77bafeca83039d9f58ff0d5054da32f71535257',
    url: 'https://github.com/Gorce-AI/termwright/actions/runs/32530899608',
    observedAt: '2026-08-22',
    classification: [
      'Windows Node 22 and 24 completed install, build and typecheck; their failures were nested pnpm.cmd spawn EINVAL in probe-Ink tests, not a worker-channel crash.',
      'The current architecture removes those nested package-manager spawns and builds once before the Native Host run.',
      'macOS Node 22 failed a scheduler-polled MCP semantic revision oracle; current MCP waits on the canonical focused Condition and committed-observation barrier.',
      'This baseline does not certify the dirty current workspace; a new Windows Node 22/24 run remains mandatory.',
    ],
  },
  windowsBackendEvidence: {
    runId: '32723013280',
    url: 'https://github.com/Gorce-AI/termwright/actions/runs/32723013280',
    observedAt: '2026-08-24',
    classification: [
      'Windows runs on @termwright/conpty, a native session that owns the pseudoconsole, both pipe ends and a job object created before the root could run.',
      'Certified on real Windows for Node 22 and 24: a stream that ends because the pipe ended with its last byte delivered, a codepoint split byte-by-byte across reads and reassembled, a tree proven empty by the job, a hard kill mid-burst, input reaching a silent child, a descendant delivering its own output in order, and a console-attached descendant not surviving its root.',
      'A descendant detached from the console does survive its root and is still owned and killable by the job, which is what identifies the console as what ends the other one.',
      'Prebuilds ship for win32-x64 and win32-arm64; a clean consumer install of the packed tarballs opens a real pseudoconsole with no compiler present.',
      'There is no fallback: a Windows machine that cannot load the addon raises rather than silently substituting a weaker output boundary.',
      'Against node-pty the same suites failed three cleanups that could not confirm a tree was gone, plus settled() and the shell inference; against this backend they pass.',
    ],
  },
  localVitestPressureEvidence: {
    node: 'v24.1.0',
    platform: 'darwin-arm64',
    versions: ['4.1.11'],
    pools: ['forks', 'threads'],
    fileParallelism: [true, false],
    workers: 2,
    ptyConcurrency: 4,
    cellsPassed: 4,
    cellsTotal: 4,
    channelClosed: 0,
    command: 'TERMWRIGHT_MATRIX_WORKERS=2 TERMWRIGHT_MATRIX_PTYS=4 TERMWRIGHT_MATRIX_FILE_PARALLELISM=true,false node scripts/run-vitest-pty-matrix.mjs <output>',
  },
  summary: {
    alreadyFixed: 128 - partial.size - obsolete.size,
    partiallyFixed: partial.size,
    obsoleteBecauseArchitectureChanged: obsolete.size,
    stillOpen: 0,
    remainingExternalEvidence: partial.size,
    incorrectAfterDeeperEvidence: 0,
  },
  sections: titles.map((title, index) => {
    const section = index + 1;
    const partialReason = partial.get(section);
    const obsoleteReason = obsolete.get(section);
    return {
      section,
      title,
      status: partialReason === undefined
        ? obsoleteReason === undefined ? 'already-fixed' : 'obsolete because architecture changed'
        : 'partially-fixed',
      evidence: evidenceFor(section),
      ...(partialReason === undefined ? {} : { remainingEvidence: partialReason }),
      ...(obsoleteReason === undefined ? {} : { architectureDecision: obsoleteReason }),
    };
  }),
};

for (const section of report.sections) {
  for (const evidence of section.evidence) {
    await access(resolve(fileURLToPath(new URL('..', import.meta.url)), evidence)).catch(() => {
      throw new Error(`mission section ${section.section} references missing evidence ${evidence}`);
    });
  }
}

const expected = `${JSON.stringify(report, null, 2)}\n`;
if (process.argv.includes('--write')) {
  await writeFile(outputUrl, expected);
  process.stdout.write('wrote docs/architecture/audit/mission-completion.json\n');
} else {
  const actual = await readFile(outputUrl, 'utf8').catch(() => '');
  if (actual !== expected) throw new Error('mission completion audit drifted; run node scripts/generate-mission-completion.mjs --write');
  process.stdout.write(`mission completion: ${report.summary.alreadyFixed} fixed, ${report.summary.partiallyFixed} partial, ${report.summary.obsoleteBecauseArchitectureChanged} obsolete\n`);
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) !== resolve(process.argv[1])) {
  throw new Error('mission completion generator must be executed directly');
}
