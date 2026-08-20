import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ADAPTER_CAPABILITIES, PROBE_CAPABILITIES } from '../packages/protocol/src/index.js';
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

interface CapabilityVariant {
  readonly when: string;
  readonly capabilities: readonly string[];
}

interface InstrumentedModule {
  readonly name: string;
  readonly version: string;
  readonly patchSetVersion: number;
  readonly optional?: boolean;
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
    readonly adapterCapabilityVariants: readonly CapabilityVariant[];
  };
  readonly instrumentation: {
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
  readonly limitations: readonly string[];
}

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
  CapBounds: 'bounds',
  CapAbsoluteBounds: 'absolute-bounds',
  CapStates: 'states',
  CapActions: 'actions',
  CapTextRanges: 'text-ranges',
  CapRenderRevisions: 'render-revisions',
  CapTreeDiffs: 'tree-diffs',
  CapLogs: 'logs',
  ProbeCapStableIdentity: 'stable-identity',
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

function defaultGoAdapterCapabilities(): string[] {
  const source = text('clients/go/protocol/client.go');
  const body = /var DefaultCapabilities = \[\]Capability\{(?<body>[\s\S]*?)\n\}/u.exec(source)
    ?.groups?.['body'];
  if (body === undefined) throw new Error('could not find Go DefaultCapabilities');
  return [...body.matchAll(/\b(Cap\w+)/gu)].map((match) => {
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

function moduleKey(module: InstrumentedModule | PatchManifest): string {
  const name = 'name' in module ? module.name : module.framework;
  const version = 'version' in module ? module.version : module.frameworkVersion;
  return `${name}@${version}#${module.patchSetVersion}`;
}

describe('machine-readable framework compatibility registry', () => {
  it('is bounded, unique and uses the protocol closed capability vocabularies', () => {
    expect(registry.schemaVersion).toBe(1);
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
      for (const variant of entry.probe.adapterCapabilityVariants) {
        expect(new Set(variant.capabilities).size).toBe(variant.capabilities.length);
        for (const capability of variant.capabilities) {
          expect(ADAPTER_CAPABILITIES, `${entry.id}: ${capability}`).toContain(capability);
        }
      }
      if (entry.probe.capabilities.includes('stable-identity')) {
        expect(entry.probe.identityKind, `${entry.id}: stable-identity coherence`).toBe('stable');
      }
      if (entry.annotations === null) {
        expect(entry.probe.capabilities, `${entry.id}: annotation coherence`).not.toContain(
          'annotations',
        );
      }
    }
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
      .flatMap((id) => framework(id).instrumentation.variants)
      .flatMap((variant) => variant.modules)
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
    const inkAdapter =
      /const baseCapabilities:[^=]+?=\s*includeGeometry\s*\?\s*\[(?<withBounds>[\s\S]*?)\]\s*:\s*\[(?<withoutBounds>[\s\S]*?)\]/u
        .exec(inkInstrument)?.groups;
    if (inkAdapter === undefined) throw new Error('could not find Ink adapter capability variants');
    expect(framework('ink').probe.adapterCapabilityVariants.map((variant) => variant.capabilities))
      .toEqual([
        quotedValues(inkAdapter['withBounds'] as string),
        quotedValues(inkAdapter['withoutBounds'] as string),
      ]);

    const opentui = openTuiProbeInfo();
    expect(framework('opentui').probe).toMatchObject({
      packageVersion: opentui.probeVersion,
      identityKind: opentui.identityKind,
      capabilities: opentui.capabilities,
    });
    expect(framework('opentui').probe.adapterCapabilityVariants[0]?.capabilities).toEqual(
      tsArray(text('packages/probe-opentui/src/bootstrap.ts'), 'BASE_CAPABILITIES'),
    );
  });

  it('matches declared and audited ranges for the preload and Python probes', () => {
    const inkManifest = json<{
      readonly peerDependencies: Readonly<Record<string, string>>;
      readonly devDependencies: Readonly<Record<string, string>>;
    }>('packages/probe-ink/package.json');
    expect(framework('ink').versions).toMatchObject({
      declared: inkManifest.peerDependencies['ink'],
      verified: [inkManifest.devDependencies['ink']?.replace(/^\^/u, '')],
    });

    const openTuiReadme = text('packages/probe-opentui/README.md');
    const declaredOpenTui = /Peer: `@opentui\/core ([^`]+)`/u.exec(openTuiReadme)?.[1];
    const openTuiManifest = json<{
      readonly devDependencies: Readonly<Record<string, string>>;
    }>('packages/probe-opentui/package.json');
    expect(framework('opentui').versions).toMatchObject({
      declared: declaredOpenTui?.replace(/\s+/gu, ''),
      verified: [openTuiManifest.devDependencies['@opentui/core']?.replace(/^\^/u, '')],
    });

    const pythonProject = text('clients/python/pyproject.toml');
    const declaredTextual = /textual = \["textual([^"\]]+)"\]/u.exec(pythonProject)?.[1];
    const textualAudit = text('docs/architecture/audit/textual.md');
    const verifiedTextual = /\*\*Version audited:\*\* Textual ([0-9.]+)/u.exec(textualAudit)?.[1];
    expect(framework('textual').versions).toMatchObject({
      declared: declaredTextual,
      verified: [verifiedTextual],
    });
  });

  it('matches Textual ProbeInfo and adapter capabilities', () => {
    const session = text('clients/python/src/termwright_probe/session.py');
    expect(framework('textual').probe.capabilities).toEqual(
      pythonTuple(session, 'PROBE_CAPABILITIES'),
    );
    const client = text('clients/python/src/termwright/client.py');
    const adapter = pythonTuple(client, 'DEFAULT_CAPABILITIES');
    expect(framework('textual').probe.adapterCapabilityVariants[0]?.capabilities).toEqual(adapter);
  });

  it('matches tview detection, manifest and Go hello literals', () => {
    const entry = framework('tview');
    expect(entry.probe.packageVersion).toBe(TVIEW_PROBE_VERSION);
    const variant = entry.instrumentation.variants[0];
    expect(variant?.modules[0]?.name).toBe(TVIEW_FRAMEWORK);
    const source = text(
      'packages/probe-tview/upstream-patches/tview/v0.42.0/add/termwright_probe.go',
    );
    expect(entry.probe.capabilities).toEqual(goCapabilities(source, 'ProbeCapability'));
    expect(entry.probe.adapterCapabilityVariants[0]?.capabilities).toEqual(
      defaultGoAdapterCapabilities(),
    );
    expect(entry.annotations?.apis).toContain('annotate.SemanticKey');
    expect(source).toContain('termwrightResolveRelations');
    expect(source).toContain('P:        protocol.ProvenanceFramework');
    expect(source).toContain('protocol.ProvenanceAnnotation');
  });

  it('matches both Charm detection declarations and Go hello literals', () => {
    const entry = framework('charm');
    expect(entry.probe.packageVersion).toBe(CHARM_PROBE_VERSION);
    expect(entry.probe.adapterCapabilityVariants[0]?.capabilities).toEqual(
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
      expect(entry.probe.adapterCapabilityVariants[0]?.capabilities).toEqual(
        goCapabilities(source, 'Capability'),
      );
      expect(source).toContain('identityKey = "semantic/" + string(candidate.meta.Key)');
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
      Bounds: 'bounds',
      AbsoluteBounds: 'absolute-bounds',
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
    expect(entry.probe.adapterCapabilityVariants[0]?.capabilities).toEqual(adapter);
  });
});
