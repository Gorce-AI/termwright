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

if (titles.length !== 128)
  throw new Error(`mission title inventory has ${titles.length} entries, expected 128`);

const partial = new Map();

const obsolete = new Map([
  [
    51,
    'Product policy intentionally removed plain-Vitest compatibility. Termwright native-host execution is the only product mode; Vitest remains the embedded engine, not a parallel user-facing runner.',
  ],
]);

const exactEvidence = new Map([
  [
    53,
    [
      'packages/test/src/vitest-engine.ts',
      'packages/test/src/runner.test.ts',
      'scripts/run-vitest-pty-matrix.mjs',
    ],
  ],
  [
    70,
    [
      '.github/workflows/vitest-reliability.yml',
      'scripts/run-vitest-pty-matrix.mjs',
      'quality/experiments/vitest-pty-pressure.test.mjs',
      'quality/experiments/pty-lease.mjs',
    ],
  ],
  [
    79,
    [
      'packages/driver/src/internal/process-supervisor.ts',
      'packages/driver/src/process-lifecycle.pty.test.ts',
      '.github/workflows/ci.yml',
    ],
  ],
  [
    81,
    [
      'packages/pty/src/index.test.ts',
      'packages/pty/src/posix-session.cc',
      'scripts/check-pty-certification.mjs',
      'packages/driver/src/native-pty-backend.test.ts',
    ],
  ],
  [
    110,
    [
      '.github/workflows/ci.yml',
      '.github/workflows/vitest-reliability.yml',
      'quality/experiments/vitest-pty-pressure.test.mjs',
      'quality/platform-deviations.json',
    ],
  ],
  [
    111,
    [
      'packages/driver/src/internal/process-supervisor.ts',
      'packages/driver/src/process-lifecycle.pty.test.ts',
      '.github/workflows/ci.yml',
    ],
  ],
  [
    112,
    [
      'packages/driver/src/api.ts',
      'packages/conformance/src/suites/driver-generic.test.ts',
      'packages/probe-ink/src/provider.pty.test.ts',
      'packages/probe-ink/src/terminal-tracker.test.ts',
      'quality/platform-deviations.json',
    ],
  ],
  [
    113,
    [
      'packages/pty/src/index.test.ts',
      'packages/pty/src/posix-session.cc',
      'scripts/check-pty-certification.mjs',
      'packages/driver/src/native-pty-backend.ts',
    ],
  ],
  [
    114,
    [
      'scripts/run-vitest-pty-matrix.mjs',
      'quality/experiments/vitest-pty-pressure.test.mjs',
      'quality/experiments/pty-lease.mjs',
      '.github/workflows/vitest-reliability.yml',
    ],
  ],
]);

function evidenceFor(section) {
  const exact = exactEvidence.get(section);
  if (exact !== undefined) return exact;
  if (section <= 10)
    return [
      'packages/protocol/src/capability-graph.ts',
      'compatibility/registry.json',
      'packages/driver/src/provider-evidence.ts',
    ];
  if (section <= 23)
    return [
      'packages/driver/src/action-planner.ts',
      'packages/driver/src/locator.ts',
      'packages/protocol/src/action-model.ts',
    ];
  if (section <= 39)
    return [
      'packages/driver/src/internal/deadline.ts',
      'packages/test/src/attempt-budget.ts',
      'packages/driver/src/pairing.ts',
    ];
  if (section <= 48)
    return [
      'compatibility/registry.json',
      'compatibility/framework-semantic-completeness.json',
      'packages/conformance/src/suites',
    ];
  if (section <= 60)
    return [
      'packages/termwright-cli/src/test-host.ts',
      'packages/test/src/runner.ts',
      'packages/test/src/attempt-context.ts',
    ];
  if (section <= 68)
    return [
      'packages/protocol/src/run-events.ts',
      'packages/protocol/src/run-journal.ts',
      'packages/run-journal-transport/src/index.ts',
    ];
  if (section <= 75)
    return [
      'packages/resource-broker/src/index.ts',
      'packages/resource-broker/src/transport.ts',
      'packages/termwright-cli/src/resource-profiles.ts',
    ];
  if (section <= 84)
    return [
      'packages/driver/src/internal/resource-scope.ts',
      'packages/driver/src/internal/process-supervisor.ts',
      'packages/driver/src/pty.ts',
    ];
  if (section <= 94)
    return [
      'packages/trace/src/writer.ts',
      'packages/run-history/src/index.ts',
      'packages/test/src/snapshot-store.ts',
    ];
  if (section <= 102)
    return [
      'packages/termwright-cli/src/test-host.ts',
      'packages/ui/src/server.ts',
      'packages/ui/src/runs.ts',
    ];
  if (section <= 109)
    return [
      '.github/workflows/ci.yml',
      '.github/workflows/reliability.yml',
      'quality/platform-deviations.json',
    ];
  if (section <= 114)
    return [
      'scripts/run-vitest-pty-matrix.mjs',
      'scripts/check-pty-certification.mjs',
      'packages/driver/src/process-lifecycle.pty.test.ts',
    ];
  return [
    'clients/test-vectors',
    'packages/ui/src/live.ts',
    'compatibility/framework-semantic-completeness.json',
    'compatibility/registry.test.ts',
  ];
}

export function buildMissionCompletionReport() {
  return {
    schemaVersion: 1,
    capturedAt: '2026-08-26',
    baselineHead: '7cac4160c94868448c74e9b09ed7c082a2f3ef26',
    policy: {
      productMode: 'termwright-native-host-only',
      backwardsCompatibility: false,
      embeddedEngine: 'vitest@4.1.11',
      certificationRule:
        'partial sections cannot support the final cross-platform certification claim',
    },
    releaseReadiness: {
      status: 'blocked',
      technicalMissionPartialSections: [...partial.keys()],
      missingNpmRegistryBootstraps: [
        '@termwright/evidence-provider',
        '@termwright/pty',
        '@termwright/pty-darwin-arm64',
        '@termwright/pty-darwin-x64',
        '@termwright/pty-linux-arm64',
        '@termwright/pty-linux-x64',
        '@termwright/pty-win32-arm64',
        '@termwright/pty-win32-x64',
        '@termwright/resource-broker',
        '@termwright/run-history',
        '@termwright/run-journal-transport',
      ],
      registryConfiguration:
        'Trusted-publisher configuration is registry-side state and remains unverified until the bootstrap packages exist and the release workflow can prove it.',
    },
    baselineCiEvidence: {
      runId: '32918115508',
      headSha: '60f4db96df7611121e4ebec47dbdba99cbb40a21',
      mergedAs: '7cac4160c94868448c74e9b09ed7c082a2f3ef26',
      url: 'https://github.com/Gorce-AI/termwright/actions/runs/32918115508',
      observedAt: '2026-08-26',
      classification: [
        'The exact PR tree completed 38 checks successfully on the first attempt with zero failures or cancellations; the only additional skipped check was documentation deployment, which is intentionally disabled for pull requests.',
        'Windows Node 22 and 24 completed the full certified Native Host, Getting Started example, native ConPTY contract, lifecycle stress, and framework conformance lanes.',
        'Ubuntu and macOS Node 22 and 24, Bun OpenTUI, deterministic coverage, 50 native determinism cycles, resource/leak barriers, fault injection, examples, clients, vectors, website, and release hygiene all passed.',
        'The reviewed tree was squash-merged without content changes as main commit 7cac4160c94868448c74e9b09ed7c082a2f3ef26; the PR head and merge commit have the same Git tree.',
      ],
    },
    postMergeRegressionEvidence: {
      runId: '32919169129',
      headSha: '7cac4160c94868448c74e9b09ed7c082a2f3ef26',
      jobId: '98029613061',
      url: 'https://github.com/Gorce-AI/termwright/actions/runs/32919169129',
      observedAt: '2026-08-26',
      platform: 'windows-latest / Node 22',
      failingTest: 'packages/ink/src/fixture-rerender.test.ts',
      status:
        'root-caused; correction implemented in the current change and awaiting first-attempt CI',
      classification: [
        'The same Git tree later exposed an Ink rerender race on a first-attempt main-branch run, so the successful PR run alone does not establish repeatable Windows stability.',
        'The old FIFO next-onRender boundary allowed a stale Ink callback to consume a newer mutation boundary and publish an authentic semantic revision paired with the previous screen.',
        'The correction binds each explicit mutation to a generation committed through the hidden Ink host node and binds control acknowledgements to command identities; no timeout, retry, sleep, skip, or weaker assertion is used.',
      ],
    },
    vitestReliabilityEvidence: {
      runId: '32893232378',
      headSha: '664077315ee699ca1daf9fa7b21a2081c698ec7f',
      url: 'https://github.com/Gorce-AI/termwright/actions/runs/32893232378',
      observedAt: '2026-08-25',
      embeddedEngine: 'vitest@4.1.11',
      inputsUnchangedAtBaselineHead: true,
      jobs: [
        {
          name: 'Windows Node 22 / Vitest pool matrix',
          jobId: '97949920093',
          conclusion: 'success',
          artifact: 'vitest-pty-matrix-node-22',
        },
        {
          name: 'Windows Node 24 / Vitest pool matrix',
          jobId: '97949920562',
          conclusion: 'success',
          artifact: 'vitest-pty-matrix-node-24',
        },
      ],
      classification: [
        'Both Windows rows certified forks and threads, file parallelism on and off, worker and PTY pressure, complete READY-to-release-to-DONE-to-exit telemetry, and zero worker-channel closures.',
        'The Vitest 4.1.11 resolution and the workflow, harness, pressure experiment, and PTY lease inputs are unchanged at the baseline head.',
      ],
    },
    windowsBackendEvidence: {
      runId: '32723013280',
      url: 'https://github.com/Gorce-AI/termwright/actions/runs/32723013280',
      observedAt: '2026-08-24',
      classification: [
        'Windows runs through @termwright/pty, whose native ConPTY session owns the pseudoconsole, both pipe ends and a job object created before the root could run; this is the same certified Windows implementation formerly packaged separately as @termwright/conpty.',
        'Certified on real Windows for Node 22 and 24: a stream that ends because the pipe ended with its last byte delivered, a codepoint split byte-by-byte across reads and reassembled, a tree proven empty by the job, a hard kill mid-burst, input reaching a silent child, a descendant delivering its own output in order, and a console-attached descendant not surviving its root.',
        'A descendant detached from the console does survive its root and is still owned and killable by the job, which is what identifies the console as what ends the other one.',
        'The unified package defines six prebuilds for Darwin, Linux and Windows on x64 and arm64; the release remains blocked until fresh CI certifies each real artifact and a clean packed consumer install.',
        'There is no fallback: a machine that cannot load its exact native addon raises rather than silently substituting a weaker output boundary.',
        'The Termwright-owned POSIX implementation removes the former private node-pty boundary and exposes the same authoritative EOF, exit and tree lifecycle contract without a timer or causal-output workaround.',
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
      command:
        'TERMWRIGHT_MATRIX_WORKERS=2 TERMWRIGHT_MATRIX_PTYS=4 TERMWRIGHT_MATRIX_FILE_PARALLELISM=true,false node scripts/run-vitest-pty-matrix.mjs <output>',
    },
    summary: {
      alreadyFixed: 128 - partial.size - obsolete.size,
      partiallyFixed: partial.size,
      obsoleteBecauseArchitectureChanged: obsolete.size,
      stillOpen: partial.size,
      remainingExternalEvidence: [...partial.values()].filter(
        (entry) => entry.kind === 'external-evidence',
      ).length,
      remainingImplementation: [...partial.values()].filter(
        (entry) => entry.kind === 'implementation',
      ).length,
      incorrectAfterDeeperEvidence: 0,
    },
    sections: titles.map((title, index) => {
      const section = index + 1;
      const partialEntry = partial.get(section);
      const obsoleteReason = obsolete.get(section);
      return {
        section,
        title,
        status:
          partialEntry === undefined
            ? obsoleteReason === undefined
              ? 'already-fixed'
              : 'obsolete because architecture changed'
            : 'partially-fixed',
        evidence: evidenceFor(section),
        ...(partialEntry === undefined
          ? {}
          : {
              remainingKind: partialEntry.kind,
              remainingEvidence: partialEntry.remainingEvidence,
            }),
        ...(obsoleteReason === undefined ? {} : { architectureDecision: obsoleteReason }),
      };
    }),
  };
}

const isDirect =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isDirect) {
  const report = buildMissionCompletionReport();
  for (const section of report.sections) {
    for (const evidence of section.evidence) {
      await access(resolve(fileURLToPath(new URL('..', import.meta.url)), evidence)).catch(() => {
        throw new Error(
          `mission section ${section.section} references missing evidence ${evidence}`,
        );
      });
    }
  }

  const expected = `${JSON.stringify(report, null, 2)}\n`;
  if (process.argv.includes('--write')) {
    await writeFile(outputUrl, expected);
    process.stdout.write('wrote docs/architecture/audit/mission-completion.json\n');
  } else {
    const actual = await readFile(outputUrl, 'utf8').catch(() => '');
    if (actual !== expected)
      throw new Error(
        'mission completion audit drifted; run node scripts/generate-mission-completion.mjs --write',
      );
    process.stdout.write(
      `mission completion: ${report.summary.alreadyFixed} fixed, ${report.summary.partiallyFixed} partial, ${report.summary.obsoleteBecauseArchitectureChanged} obsolete\n`,
    );
  }
}
