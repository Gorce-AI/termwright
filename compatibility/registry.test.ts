import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ADAPTER_CAPABILITIES,
  CAPABILITY_CONFORMANCE_CLAIMS,
  CAPABILITY_GRAPH,
  EVIDENCE_PROVIDER_CAPABILITIES,
  EVIDENCE_PROVIDER_TYPES,
  PROBE_CAPABILITIES,
  RUNTIME_PREREQUISITES,
  SESSION_CAPABILITIES,
  capabilityNode,
  capabilityRemediation,
  validateCapabilityGraph,
  type CapabilityConformanceClaimId,
  type SessionCapabilityId,
} from '../packages/protocol/src/index.js';
import { probeInfo as inkProbeInfo } from '../packages/probe-ink/src/session.js';
import { probeInfo as openTuiProbeInfo } from '../packages/probe-opentui/src/session.js';
import {
  BUBBLETEA_MODULES,
  COMPANION_MODULES,
  capabilitiesFor,
} from '../packages/probe-charm/src/detect.js';
import {
  PROBE_VERSION as CHARM_PROBE_VERSION,
} from '../packages/probe-charm/src/launch.js';
import {
  FRAMEWORK as TVIEW_FRAMEWORK,
  PROBE_VERSION as TVIEW_PROBE_VERSION,
} from '../packages/probe-tview/src/launch.js';
import { describe, expect, it } from 'vitest';

interface InstrumentedModule {
  readonly name: string;
  readonly version: string;
  readonly optional?: boolean;
}

interface CertifiedPatchSet {
  readonly name: string;
  readonly version: string;
  readonly patchSetVersion: number;
}

interface RegistryFramework {
  readonly id: string;
  readonly name: string;
  readonly frameworkPackage: string;
  readonly versions: {
    readonly policy: 'exact' | 'range';
    readonly declared: string;
    readonly verified: readonly string[];
  };
  readonly runtimes: readonly {
    readonly name: string;
    readonly version: string;
  }[];
  readonly probe: {
    readonly package: string;
    readonly packageVersion: string;
    readonly identityKind: 'stable' | 'frame-local' | 'correlated';
    readonly capabilities: readonly string[];
    readonly adapterCapabilities: readonly string[];
  };
  readonly instrumentation: {
    readonly strategy: string;
    readonly patchSets: readonly CertifiedPatchSet[];
    readonly variants: readonly {
      readonly id: string;
      readonly frameworkVersion: string;
      readonly modules: readonly InstrumentedModule[];
    }[];
  };
  readonly annotations: null | {
    readonly package: string;
    readonly packageVersion: string;
    readonly apis: readonly string[];
  };
  readonly certification: {
    readonly ids: readonly string[];
    readonly adapterVersion: string;
    readonly strategy: 'native-hook' | 'runtime-capability-and-behavior' | 'checksummed-instrumentation' | 'checksummed-replacement';
    readonly checksumSources: readonly string[];
  };
  readonly capabilityGraph: {
    readonly automatic: readonly SessionCapabilityId[];
    readonly applicationIntegrated: readonly {
      readonly providerType: string;
      readonly providerCapabilities: readonly string[];
      readonly capabilities: readonly SessionCapabilityId[];
      readonly sdks: readonly string[];
    }[];
    readonly input: readonly {
      readonly capability: SessionCapabilityId;
      readonly producerFacts: readonly string[];
      readonly providerAlternatives: readonly {
        readonly providerType: string;
        readonly providerCapabilities: readonly string[];
        readonly sdks: readonly string[];
      }[];
      readonly runtimePrerequisites: readonly string[];
    }[];
    readonly unsupported: readonly SessionCapabilityId[];
    readonly claims: readonly {
      readonly id: CapabilityConformanceClaimId;
      readonly files: readonly string[];
    }[];
  };
  readonly limitations: readonly string[];
}

describe('certification policy', () => {
  it('never applies a range guarantee to an adapter that depends on framework internals', () => {
    const internal = registry.frameworks.filter((entry) =>
      /checksummed|patched cop(?:y|ies)|post_display_hook|renderer|compositor|workspace redirects|Cargo redirects/iu.test(
        entry.instrumentation.strategy,
      ),
    );
    expect(internal.length).toBeGreaterThan(0);
    for (const entry of internal) {
      expect(entry.versions.policy, entry.id).toBe('exact');
      expect(entry.versions.declared, entry.id).toBe(entry.versions.verified.join(' or '));
    }
  });

  it('keeps the bundled Python Textual allowlist equal to the executable registry', () => {
    const source = text('clients/python/src/termwright_probe/certified_textual.py');
    const tuple = /CERTIFIED_TEXTUAL_VERSIONS\s*=\s*\(([^)]*)\)/u.exec(source)?.[1] ?? '';
    const bundled = quotedValues(tuple);
    expect(bundled).toEqual(framework('textual').versions.verified);
  });
});

interface Registry {
  readonly schemaVersion: number;
  readonly frameworks: readonly RegistryFramework[];
}

interface PatchManifest {
  readonly framework: string;
  readonly frameworkVersion: string;
  readonly patchSetVersion: number;
}

const root = fileURLToPath(new URL('..', import.meta.url));
const registry = json<Registry>('compatibility/registry.json');
const frameworks = new Map(registry.frameworks.map((entry) => [entry.id, entry]));

function json<T>(relative: string): T {
  return JSON.parse(readFileSync(join(root, relative), 'utf8')) as T;
}

function text(relative: string): string {
  return readFileSync(join(root, relative), 'utf8');
}

function framework(id: string): RegistryFramework {
  const entry = frameworks.get(id);
  if (entry === undefined) throw new Error(`compatibility registry has no ${id} row`);
  return entry;
}

function runtime(id: string, name: string): string | undefined {
  return framework(id).runtimes.find((entry) => entry.name === name)?.version;
}

function packageVersion(relative: string): string {
  return json<{ readonly version: string }>(relative).version;
}

function projectVersion(relative: string): string {
  const match = /^version\s*=\s*"([^"]+)"/mu.exec(text(relative));
  if (match?.[1] === undefined) throw new Error(`${relative} has no project/package version`);
  return match[1];
}

function quotedValues(source: string): string[] {
  return [...source.matchAll(/['"]([^'"]+)['"]/gu)].map((match) => match[1] as string);
}

function pythonTuple(source: string, name: string): string[] {
  const body = new RegExp(`${name}\\s*=\\s*\\((?<body>[\\s\\S]*?)\\)`, 'u').exec(source)
    ?.groups?.['body'];
  if (body === undefined) throw new Error(`could not find Python tuple ${name}`);
  return quotedValues(body);
}

function tsArray(source: string, name: string): string[] {
  const body = new RegExp(
    `const ${name}(?:\\s*:[^=]+)?\\s*=\\s*\\[(?<body>[\\s\\S]*?)\\]`,
    'u',
  ).exec(source)?.groups?.['body'];
  if (body === undefined) throw new Error(`could not find TypeScript array ${name}`);
  return quotedValues(body);
}

const goCapabilityNames: Readonly<Record<string, string>> = {
  CapTree: 'tree',
  CapIntendedGeometry: 'intended-geometry',
  CapClippedGeometry: 'clipped-geometry',
  CapStates: 'states',
  CapFocusState: 'focus-state',
  CapActions: 'actions',
  CapActionRecipes: 'action-recipes',
  CapTextRanges: 'text-ranges',
  CapRenderRevisions: 'render-revisions',
  CapLogs: 'logs',
  ProbeCapStableIdentity: 'stable-identity',
  ProbeCapIntendedRect: 'intended-rect',
  ProbeCapVisibleRect: 'visible-rect',
  ProbeCapOperations: 'operations',
  ProbeCapAnnotations: 'annotations',
  ProbeCapFrameBegin: 'frame-begin',
  ProbeCapPaintOrder: 'paint-order',
};

function goCapabilities(source: string, type: 'Capability' | 'ProbeCapability'): string[] {
  const body = new RegExp(
    `Capabilities:\\s*\\[\\]protocol\\.${type}\\{(?<body>[\\s\\S]*?)\\n\\s*\\}`,
    'u',
  ).exec(source)?.groups?.['body'];
  if (body === undefined) throw new Error(`could not find Go ${type} handshake literal`);
  return [...body.matchAll(/protocol\.(\w+)/gu)].map((match) => {
    const name = match[1] as string;
    const capability = goCapabilityNames[name];
    if (capability === undefined) throw new Error(`unknown Go capability constant ${name}`);
    return capability;
  });
}

function patchManifests(relative: string): PatchManifest[] {
  const base = join(root, relative);
  const found: PatchManifest[] = [];
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.name === 'manifest.json') {
        found.push(JSON.parse(readFileSync(path, 'utf8')) as PatchManifest);
      }
    }
  };
  visit(base);
  return found;
}

function moduleKey(module: CertifiedPatchSet | PatchManifest): string {
  const name = 'name' in module ? module.name : module.framework;
  const version = 'version' in module ? module.version : module.frameworkVersion;
  return `${name}@${version}#${module.patchSetVersion}`;
}

describe('machine-readable framework compatibility registry', () => {
  it('uses schema v5 and contains no legacy single-producer capability matrices', () => {
    expect(registry.schemaVersion).toBe(5);
    for (const legacy of ['geometry', 'applicationProviders', 'terminalPrerequisites', 'adapterCapabilityVariants', 'conformance']) {
      expect(text('compatibility/registry.json')).not.toContain(`"${legacy}"`);
    }
    expect(validateCapabilityGraph()).toEqual({ ok: true, errors: [] });
    const schema = json<{ readonly $defs: Readonly<Record<string, { readonly enum?: readonly string[] }>> }>('compatibility/schema.json');
    expect(schema.$defs['sessionCapability']?.enum).toEqual(SESSION_CAPABILITIES);
    expect(schema.$defs['probeCapability']?.enum).toEqual(PROBE_CAPABILITIES);
    expect(schema.$defs['adapterCapability']?.enum).toEqual(ADAPTER_CAPABILITIES);
    expect(schema.$defs['providerCapability']?.enum).toEqual(EVIDENCE_PROVIDER_CAPABILITIES);
    expect(schema.$defs['runtimePrerequisite']?.enum).toEqual(RUNTIME_PREREQUISITES);
    expect(schema.$defs['claimId']?.enum).toEqual(CAPABILITY_CONFORMANCE_CLAIMS);
  });

  it('is bounded, unique and partitions every session capability exactly once', () => {
    expect(registry.frameworks.map((entry) => entry.id)).toEqual([
      'ink',
      'opentui',
      'textual',
      'tview',
      'ratatui',
      'charm',
    ]);
    expect(new Set(registry.frameworks.map((entry) => entry.id)).size).toBe(
      registry.frameworks.length,
    );

    for (const entry of registry.frameworks) {
      expect(entry.versions.verified.length, `${entry.id}: verified versions`).toBeGreaterThan(0);
      expect(entry.limitations.length, `${entry.id}: limitations`).toBeGreaterThan(0);
      expect(new Set(entry.probe.capabilities).size).toBe(entry.probe.capabilities.length);
      for (const capability of entry.probe.capabilities) {
        expect(PROBE_CAPABILITIES, `${entry.id}: ${capability}`).toContain(capability);
      }
      expect(new Set(entry.probe.adapterCapabilities).size).toBe(entry.probe.adapterCapabilities.length);
      for (const capability of entry.probe.adapterCapabilities) {
        expect(ADAPTER_CAPABILITIES, `${entry.id}: ${capability}`).toContain(capability);
        expect(capabilityNode(`adapter.${capability as (typeof ADAPTER_CAPABILITIES)[number]}`)).toBeDefined();
      }
      if (entry.probe.capabilities.includes('stable-identity')) {
        expect(entry.probe.identityKind, `${entry.id}: stable-identity coherence`).toBe('stable');
      }
      if (entry.annotations === null) {
        expect(entry.probe.capabilities, `${entry.id}: annotation coherence`).not.toContain(
          'annotations',
        );
      }

      const partitions = [
        ...entry.capabilityGraph.automatic,
        ...entry.capabilityGraph.applicationIntegrated.flatMap((integration) => integration.capabilities),
        ...entry.capabilityGraph.input.map(({ capability }) => capability),
        ...entry.capabilityGraph.unsupported,
      ];
      expect(partitions.slice().sort(), `${entry.id}: complete graph partition`).toEqual([...SESSION_CAPABILITIES].sort());
      expect(new Set(partitions).size, `${entry.id}: disjoint graph partition`).toBe(partitions.length);
      for (const capability of partitions) capabilityNode(`session.${capability}`);
      for (const integration of entry.capabilityGraph.applicationIntegrated) {
        expect(EVIDENCE_PROVIDER_TYPES).toContain(integration.providerType);
        expect(integration.sdks.length).toBeGreaterThan(0);
        for (const producer of integration.providerCapabilities) {
          expect(EVIDENCE_PROVIDER_CAPABILITIES).toContain(producer);
          expect(CAPABILITY_GRAPH.edges).toContainEqual({
            from: `provider.${producer}`, to: `session.${integration.capabilities[integration.providerCapabilities.indexOf(producer)]}`, kind: 'produces',
          });
        }
      }
      for (const input of entry.capabilityGraph.input) {
        for (const prerequisite of input.runtimePrerequisites) expect(RUNTIME_PREREQUISITES).toContain(prerequisite);
        for (const alternative of input.providerAlternatives) {
          expect(EVIDENCE_PROVIDER_TYPES).toContain(alternative.providerType);
          expect(alternative.sdks.length).toBeGreaterThan(0);
          for (const producer of alternative.providerCapabilities) {
            expect(EVIDENCE_PROVIDER_CAPABILITIES).toContain(producer);
            expect(CAPABILITY_GRAPH.edges).toContainEqual({
              from: `provider.${producer}`,
              to: `session.${input.capability}`,
              kind: 'produces',
            });
          }
        }
      }
      expect(entry.certification.adapterVersion, `${entry.id}: adapter version`).toBe(entry.probe.packageVersion);
      expect(entry.certification.ids, `${entry.id}: certification ids`).toEqual(
        entry.versions.verified.map((version) => `${entry.id}@${version}/${entry.probe.packageVersion}`),
      );
      if (entry.certification.strategy === 'native-hook') {
        expect(entry.certification.checksumSources, `${entry.id}: native hook checksums`).toEqual([]);
      } else {
        expect(entry.certification.checksumSources.length, `${entry.id}: checksum linkage`).toBeGreaterThan(0);
      }
      for (const source of entry.certification.checksumSources) {
        expect(existsSync(join(root, source)), `${entry.id}: ${source}`).toBe(true);
        if (entry.certification.strategy !== 'runtime-capability-and-behavior') {
          expect(text(source), `${entry.id}: ${source} carries sha256 evidence`).toMatch(/sha256/iu);
        }
      }
      const claims = new Map(entry.capabilityGraph.claims.map((claim) => [claim.id, claim.files]));
      const guaranteed = [
        ...entry.capabilityGraph.automatic,
        ...entry.capabilityGraph.applicationIntegrated.flatMap(({ capabilities }) => capabilities),
        ...entry.capabilityGraph.input.map(({ capability }) => capability),
      ];
      for (const capability of guaranteed) {
        for (const claim of capabilityNode(`session.${capability}`).conformanceClaims ?? []) {
          expect(claims.has(claim), `${entry.id}: missing executable ${claim}`).toBe(true);
        }
      }
      for (const [claim, files] of claims) {
        expect(CAPABILITY_CONFORMANCE_CLAIMS).toContain(claim);
        expect(files.length, `${entry.id}: ${claim}`).toBeGreaterThan(0);
        for (const fixture of files) {
          expect(existsSync(join(root, fixture)), `${entry.id}: claim file ${fixture}`).toBe(true);
          expect(fixture).toMatch(/(?:\/tests\/|(?:test|spec)[^/]*\.)/u);
        }
      }
      for (const capability of entry.capabilityGraph.unsupported) {
        const remediation = capabilityRemediation(`session.${capability}`);
        expect(remediation.message.length, `${entry.id}: remediation ${capability}`).toBeGreaterThan(10);
        if (remediation.code === 'register-application-provider') {
          expect(entry.capabilityGraph.applicationIntegrated.some(({ capabilities }) => capabilities.includes(capability)),
            `${entry.id}: impossible provider remediation ${capability}`).toBe(true);
        }
      }
    }
  });

  it('derives automatic guarantees from exact producer facts and never diagnostic evidence', () => {
    const producerFor: Partial<Record<SessionCapabilityId, string>> = {
      'semantic-tree': 'adapter.tree', 'stable-identity': 'probe.stable-identity',
      'intended-geometry': 'adapter.intended-geometry', 'clipped-geometry': 'adapter.clipped-geometry',
      'pointer-geometry': 'adapter.pointer-hit-grid', 'pointer-hit-testing': 'adapter.pointer-hit-grid',
      focus: 'adapter.focus-state',
      'render-order': 'probe.paint-order', 'paired-revisions': 'adapter.render-revisions',
    };
    for (const entry of registry.frameworks) {
      for (const capability of entry.capabilityGraph.automatic) {
        const producer = producerFor[capability];
        if (producer === undefined) continue;
        const raw = producer.replace(/^(?:adapter|probe)\./u, '');
        const announced = producer.startsWith('adapter.') ? entry.probe.adapterCapabilities : entry.probe.capabilities;
        expect(announced, `${entry.id}: producer for ${capability}`).toContain(raw);
        expect(CAPABILITY_GRAPH.edges.some((edge) => edge.from === producer && edge.to === `session.${capability}` && edge.kind === 'produces')).toBe(true);
      }
      expect(entry.capabilityGraph.applicationIntegrated).toContainEqual(
        expect.objectContaining({
          providerType: 'scroll-evidence',
          providerCapabilities: ['scroll-state'],
          capabilities: ['scroll'],
        }),
      );
      expect(entry.capabilityGraph.applicationIntegrated).toContainEqual(
        expect.objectContaining({
          providerType: 'paint-evidence',
          providerCapabilities: ['painted-regions'],
          capabilities: ['painted-region'],
        }),
      );
      if (entry.probe.adapterCapabilities.includes('focus-state')) {
        expect(entry.capabilityGraph.automatic).toContain('focus');
      } else {
        expect(entry.capabilityGraph.applicationIntegrated).toContainEqual(
          expect.objectContaining({
            providerType: 'focus-evidence',
            providerCapabilities: ['focus-state'],
            capabilities: ['focus'],
          }),
        );
      }
    }
  });

  it('keeps Ratatui and Bubble Tea production-router support application-integrated', () => {
    for (const id of ['ratatui', 'charm'] as const) {
      const entry = framework(id);
      const integration = entry.capabilityGraph.applicationIntegrated.find(({ providerType }) => providerType === 'pointer-evidence');
      expect(integration?.capabilities).toEqual(['pointer-geometry', 'pointer-hit-testing']);
      expect(integration?.providerCapabilities).toEqual(['pointer-regions', 'hit-test']);
      expect(entry.limitations.join(' ')).not.toMatch(/pointer actions are (?:unavailable|refused)/iu);
    }
  });

  it('has no second framework matrix in protocol exports, language vectors, or website code', () => {
    expect(existsSync(join(root, 'packages/protocol/src/geometry-capabilities.ts'))).toBe(false);
    expect(json<Record<string, unknown>>('clients/test-vectors/observations.json')).not.toHaveProperty(
      'frameworks',
    );
    const websiteCheck = text('website/scripts/check-geometry-matrix.mjs');
    expect(websiteCheck).toContain("../../compatibility/registry.json");
    expect(websiteCheck).toContain('capabilityGraph');
    const geometryPage = text('website/src/content/docs/reference/geometry-visibility.md');
    expect(geometryPage).toContain('<!-- geometry-matrices:start -->');
    expect(geometryPage).toContain('<!-- geometry-matrices:end -->');
  });

  it('keeps compatibility table cells aligned with their headers', () => {
    const page = text('website/src/content/docs/reference/compatibility.mdx');
    expect([...page.matchAll(/<th>([^<]+)<\/th>/gu)].map((match) => match[1])).toEqual([
      'Framework',
      'Declared / verified',
      'Runtime',
      'Probe',
      'Automatic probe capabilities',
      'Effective session graph',
      'Annotations',
    ]);

    const body = page.slice(page.indexOf('<tbody>'), page.indexOf('</tbody>'));
    const fields = [
      'entry.name',
      'entry.versions.declared',
      'entry.runtimes.map',
      'entry.probe.package',
      'entry.probe.identityKind',
      'entry.capabilityGraph.automatic',
      'entry.annotations',
    ];
    let previousOffset = -1;
    for (const field of fields) {
      const offset = body.indexOf(field);
      expect(offset, field).toBeGreaterThan(previousOffset);
      previousOffset = offset;
    }
  });

  it('keeps generated cross-language graph vectors byte-for-structure aligned', () => {
    expect(json('clients/test-vectors/capability-graph.json')).toEqual(CAPABILITY_GRAPH);
    const constants = json<Record<string, unknown>>('clients/test-vectors/constants.json');
    expect(constants['sessionCapabilities']).toEqual(SESSION_CAPABILITIES);
    expect(constants['evidenceProviderCapabilities']).toEqual(EVIDENCE_PROVIDER_CAPABILITIES);
    expect(constants['runtimePrerequisites']).toEqual(RUNTIME_PREREQUISITES);
    expect(constants['capabilityConformanceClaims']).toEqual(CAPABILITY_CONFORMANCE_CLAIMS);
  });

  it('takes every probe package version from its publish manifest', () => {
    expect(framework('ink').probe.packageVersion).toBe(
      packageVersion('packages/probe-ink/package.json'),
    );
    expect(framework('opentui').probe.packageVersion).toBe(
      packageVersion('packages/probe-opentui/package.json'),
    );
    expect(framework('textual').probe.packageVersion).toBe(
      projectVersion('clients/python/pyproject.toml'),
    );
    expect(framework('tview').probe.packageVersion).toBe(
      packageVersion('packages/probe-tview/package.json'),
    );
    expect(framework('ratatui').probe.packageVersion).toBe(
      projectVersion('clients/rust-probe/Cargo.toml'),
    );
    const ratatuiAnnotations = framework('ratatui').annotations;
    expect(ratatuiAnnotations).not.toBeNull();
    expect(ratatuiAnnotations?.package).toBe('termwright-ratatui');
    expect(ratatuiAnnotations?.packageVersion).toBe(
      projectVersion('clients/rust-ratatui/Cargo.toml'),
    );
    expect(framework('charm').probe.packageVersion).toBe(
      packageVersion('packages/probe-charm/package.json'),
    );
  });

  it('takes runtime floors from package and language manifests', () => {
    for (const id of ['ink', 'opentui', 'tview', 'charm'] as const) {
      const manifest = json<{ readonly engines: { readonly node: string } }>(
        `packages/probe-${id === 'charm' ? 'charm' : id}/package.json`,
      );
      expect(runtime(id, 'Node.js')).toBe(manifest.engines.node);
    }

    const pythonFloor = /^requires-python\s*=\s*"([^"]+)"/mu
      .exec(text('clients/python/pyproject.toml'))?.[1];
    expect(runtime('textual', 'CPython')).toBe(pythonFloor);

    const goFloor = /^go\s+([0-9.]+)/mu.exec(text('clients/go/go.mod'))?.[1];
    expect(runtime('tview', 'Go')).toBe(goFloor === undefined ? undefined : `>=${goFloor}`);
    expect(runtime('charm', 'Go')).toBe(goFloor === undefined ? undefined : `>=${goFloor}`);

    const rustFloor = /^rust-version\s*=\s*"([^"]+)"/mu
      .exec(text('clients/rust-ratatui/Cargo.toml'))?.[1];
    expect(runtime('ratatui', 'Rust')).toBe(
      rustFloor === undefined ? undefined : `>=${rustFloor}`,
    );
    expect(rustFloor).toBe('1.88');

    for (const manifest of ['clients/rust/Cargo.toml', 'clients/rust-probe/Cargo.toml']) {
      expect(/^rust-version\s*=\s*"([^"]+)"/mu.exec(text(manifest))?.[1], manifest).toBe(
        '1.74',
      );
    }
  });

  it('lists exactly the checksummed patch manifests shipped by every copy-based probe', () => {
    const fromRegistry = ['tview', 'ratatui', 'charm']
      .flatMap((id) => framework(id).instrumentation.patchSets)
      .map(moduleKey)
      .sort();
    const fromDisk = [
      ...patchManifests('packages/probe-tview/upstream-patches'),
      ...patchManifests('clients/rust-probe/upstream-patches'),
      ...patchManifests('packages/probe-charm/upstream-patches'),
    ]
      .map(moduleKey)
      .sort();
    expect(fromRegistry).toEqual(fromDisk);
  });

  it('matches the TypeScript probe declarations used in hello', () => {
    const ink = inkProbeInfo();
    expect(framework('ink').probe).toMatchObject({
      packageVersion: ink.probeVersion,
      identityKind: ink.identityKind,
      capabilities: ink.capabilities,
    });
    const inkInstrument = text('packages/probe-ink/src/instrument.ts');
    const inkAdapter = /const capabilities:[^=]+?=\s*\[(?<capabilities>[\s\S]*?)\]/u
      .exec(inkInstrument)?.groups?.['capabilities'];
    if (inkAdapter === undefined) throw new Error('could not find Ink adapter capabilities');
    expect(framework('ink').probe.adapterCapabilities).toEqual(quotedValues(inkAdapter));

    const opentui = openTuiProbeInfo();
    expect(framework('opentui').probe).toMatchObject({
      packageVersion: opentui.probeVersion,
      identityKind: opentui.identityKind,
      capabilities: opentui.capabilities,
    });
    const openTuiBootstrap = text('packages/probe-opentui/src/bootstrap.ts');
    const certifiedCapabilities =
      /capabilities:\s*\[\.\.\.BASE_CAPABILITIES,\s*(?<extra>[\s\S]*?)\]/u
        .exec(openTuiBootstrap)?.groups?.['extra'];
    if (certifiedCapabilities === undefined) {
      throw new Error('could not find OpenTUI certified adapter capabilities');
    }
    expect(framework('opentui').probe.adapterCapabilities).toEqual([
      ...tsArray(openTuiBootstrap, 'BASE_CAPABILITIES'),
      ...quotedValues(certifiedCapabilities),
    ]);
  });

  it('matches declared and audited versions for the preload and Python probes', () => {
    const inkManifest = json<{
      readonly peerDependencies: Readonly<Record<string, string>>;
      readonly devDependencies: Readonly<Record<string, string>>;
    }>('packages/probe-ink/package.json');
    expect(framework('ink').versions).toMatchObject({
      declared: inkManifest.peerDependencies['ink'],
      verified: [inkManifest.devDependencies['ink']?.replace(/^\^/u, '')],
    });

    const openTuiManifest = json<{
      readonly devDependencies: Readonly<Record<string, string>>;
    }>('packages/probe-opentui/package.json');
    const certifiedOpenTui = json<{ readonly profiles: readonly { readonly version: string }[] }>(
      'packages/probe-opentui/src/certified-runtime.json',
    ).profiles.map((profile) => profile.version);
    expect(framework('opentui').versions).toMatchObject({
      policy: 'exact',
      declared: certifiedOpenTui.join(' or '),
      verified: certifiedOpenTui,
    });
    expect(certifiedOpenTui).toContain(openTuiManifest.devDependencies['@opentui/core']?.replace(/^\^/u, ''));

    const pythonProject = text('clients/python/pyproject.toml');
    const declaredTextual = /textual = \["textual([^"\]]+)"\]/u.exec(pythonProject)?.[1];
    const textualAudit = text('docs/architecture/audit/textual.md');
    const verifiedTextual = /\*\*Version audited:\*\* Textual ([0-9.]+)/u.exec(textualAudit)?.[1];
    expect(declaredTextual).toBe(`==${verifiedTextual}`);
    expect(framework('textual').versions).toMatchObject({
      policy: 'exact',
      declared: verifiedTextual,
      verified: [verifiedTextual],
    });
  });

  it('matches Textual ProbeInfo and adapter capabilities', () => {
    const session = text('clients/python/src/termwright_probe/session.py');
    expect(framework('textual').probe.capabilities).toEqual(
      pythonTuple(session, 'PROBE_CAPABILITIES'),
    );
    const adapter = pythonTuple(session, 'TEXTUAL_CAPABILITIES');
    expect(framework('textual').probe.adapterCapabilities).toEqual(adapter);
  });

  it('matches tview detection, manifest and Go hello literals', () => {
    const entry = framework('tview');
    expect(entry.probe.packageVersion).toBe(TVIEW_PROBE_VERSION);
    const variant = entry.instrumentation.variants[0];
    expect(variant?.modules).toContainEqual(expect.objectContaining({ name: TVIEW_FRAMEWORK }));
    const source = text(
      'packages/probe-tview/upstream-patches/tview/v0.42.0/add/termwright_probe.go',
    );
    expect(entry.probe.capabilities).toEqual(goCapabilities(source, 'ProbeCapability'));
    expect(entry.probe.adapterCapabilities).toEqual(
      goCapabilities(source, 'Capability'),
    );
    expect(entry.annotations?.apis).toContain('annotate.SemanticKey');
    expect(source).toContain('termwrightResolveRelations');
    expect(source).toContain('P:        protocol.ProvenanceFramework');
    expect(source).toContain('protocol.ProvenanceAnnotation');
  });

  it('matches both Charm detection declarations and Go hello literals', () => {
    const entry = framework('charm');
    expect(entry.probe.packageVersion).toBe(CHARM_PROBE_VERSION);
    expect(entry.probe.adapterCapabilities).toEqual(
      capabilitiesFor('v1'),
    );
    expect(capabilitiesFor('v2')).toEqual(capabilitiesFor('v1'));

    for (const major of ['v1', 'v2'] as const) {
      const variant = entry.instrumentation.variants.find((item) => item.id.endsWith(major));
      expect(variant?.modules[0]?.name).toBe(BUBBLETEA_MODULES[major]);
      expect(variant?.modules[1]?.name).toBe(COMPANION_MODULES[major][0]);
      const version = variant?.frameworkVersion;
      if (version === undefined) throw new Error(`registry has no Charm ${major} variant`);
      const source = text(
        `packages/probe-charm/upstream-patches/bubbletea/${version}/add/termwright_probe.go`,
      );
      expect(entry.probe.capabilities).toEqual(goCapabilities(source, 'ProbeCapability'));
      expect(entry.probe.adapterCapabilities).toEqual(
        goCapabilities(source, 'Capability'),
      );
      expect(source).toContain('candidate.node.ID = "k:" + string(candidate.meta.Key)');
      expect(source).toContain('termwrightResolveRelations');
      expect(source).toContain('protocol.ProvenanceAnnotation');
    }
    expect(entry.annotations?.apis).toContain('annotate.SemanticKey');
  });

  it('keeps the shared Go annotation SDK additive and closed', () => {
    const source = text('clients/go/annotate/annotate.go');
    const body = /type Semantics struct \{(?<body>[\s\S]*?)\n\}/u.exec(source)?.groups?.['body'];
    if (body === undefined) throw new Error('could not find Go Semantics struct');

    for (const declaration of [
      'Key SemanticKey',
      'Actions []protocol.Action',
      'LabelledBy  []SemanticKey',
      'DescribedBy []SemanticKey',
    ]) {
      expect(body).toContain(declaration);
    }
    for (const forbidden of ['Bounds', 'Focus', 'Visible', 'Visibility', 'Value', 'State']) {
      expect(body).not.toMatch(new RegExp(`\\b${forbidden}\\b`, 'u'));
    }
  });

  it('matches Ratatui ProbeInfo and session hello declarations', () => {
    const entry = framework('ratatui');
    const launchSource = text('clients/rust-probe/src/launch.rs');
    const facade = /const FRAMEWORK_CRATE: &str = "([^"]+)"/u.exec(launchSource)?.[1];
    expect(entry.frameworkPackage).toBe(facade);
    const launchTest = text('clients/rust-probe/tests/launch.rs');
    const announcedVersion = /TERMWRIGHT_RATATUI_VERSION"\s*&&\s*value\s*==\s*"([^"]+)"/u
      .exec(launchTest)?.[1];
    expect(announcedVersion).toBeDefined();
    expect(entry.versions).toMatchObject({
      policy: 'exact',
      declared: announcedVersion,
      verified: [announcedVersion],
    });

    const sdkManifest = text('clients/rust-ratatui/Cargo.toml');
    const sdkFrameworkVersion = /ratatui\s*=\s*\{\s*version\s*=\s*"=([^"]+)"/u.exec(
      sdkManifest,
    )?.[1];
    expect(sdkFrameworkVersion).toBe(announcedVersion);
    expect(entry.annotations).toMatchObject({
      package: 'termwright-ratatui',
      packageVersion: projectVersion('clients/rust-ratatui/Cargo.toml'),
      apis: ['Annotated', 'Annotate', 'Semantics', 'Action'],
    });

    const probeSource = text('clients/rust-probe/src/lib.rs');
    const capabilities = /capabilities:\s*vec!\[(?<body>[\s\S]*?)\]/u.exec(probeSource)
      ?.groups?.['body'];
    if (capabilities === undefined) throw new Error('could not find Ratatui ProbeInfo capabilities');
    expect(entry.probe.capabilities).toEqual(quotedValues(capabilities));
    expect(probeSource).toContain('identity_kind: ProbeIdentityKind::FrameLocal');
    expect(entry.probe.identityKind).toBe('frame-local');

    const session = text('clients/rust-probe/src/session.rs');
    const adapterBody = /options\.capabilities\s*=\s*vec!\[(?<body>[\s\S]*?)\];/u.exec(session)
      ?.groups?.['body'];
    if (adapterBody === undefined) throw new Error('could not find Ratatui adapter capabilities');
    const rustNames: Readonly<Record<string, string>> = {
      Tree: 'tree',
      IntendedGeometry: 'intended-geometry',
      ClippedGeometry: 'clipped-geometry',
      States: 'states',
      Actions: 'actions',
      RenderRevisions: 'render-revisions',
    };
    const adapter = [...adapterBody.matchAll(/Capability::(\w+)/gu)].map((match) => {
      const name = match[1] as string;
      const capability = rustNames[name];
      if (capability === undefined) throw new Error(`unknown Rust capability ${name}`);
      return capability;
    });
    expect(entry.probe.adapterCapabilities).toEqual(adapter);
  });
});
