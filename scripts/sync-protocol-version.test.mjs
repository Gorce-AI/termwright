import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

import {
  rewriteCargoPathDependencies,
  synchronizeCompatibilityRegistry,
} from './sync-protocol-version.mjs';

describe('Cargo protocol lockstep release transform', () => {
  it('updates every local edge between published Termwright crates', () => {
    const source = `[dependencies]
termwright-probe-ratatui = { path = "../rust-probe", version = "0.2.0" }
termwright-protocol = { version = "0.2.0", path = "../rust" }
serde_json = "1"
`;

    const result = rewriteCargoPathDependencies(source, '0.3.0');

    expect(result.output).toContain(
      'termwright-probe-ratatui = { path = "../rust-probe", version = "0.3.0" }',
    );
    expect(result.output).toContain(
      'termwright-protocol = { version = "0.3.0", path = "../rust" }',
    );
    expect(result.changes.map(({ packageName }) => packageName)).toEqual([
      'termwright-probe-ratatui',
      'termwright-protocol',
    ]);
  });

  it('does not rewrite registry-only or unrelated path dependencies', () => {
    const source = `[dependencies]
termwright-protocol = "0.2.0"
fixture-helper = { path = "../fixture-helper", version = "0.2.0" }
`;

    expect(rewriteCargoPathDependencies(source, '0.3.0')).toEqual({
      output: source,
      changes: [],
    });
  });

  it('fails closed when a publishable local edge has no registry version', () => {
    expect(() =>
      rewriteCargoPathDependencies(
        '[dependencies]\ntermwright-protocol = { path = "../rust" }\n',
        '0.3.0',
        'clients/example/Cargo.toml',
      ),
    ).toThrow(
      'clients/example/Cargo.toml: path dependency termwright-protocol must declare a registry version for publishing',
    );
  });
});

describe('compatibility registry release metadata', () => {
  it('moves package, certification and owned T1 source identities atomically', () => {
    const registry = JSON.parse(readFileSync('compatibility/registry.json', 'utf8'));
    const tview = registry.frameworks.find(({ id }) => id === 'tview');
    const unit = tview.instrumentation.interventions
      .find(({ capability }) => capability === 'private-widget-state')
      .addedUnits.find(({ target }) => target === 'zz_termwright_probe.go');
    const digest = 'sha256:release-versioned-owned-unit';

    const result = synchronizeCompatibilityRegistry(
      registry,
      '0.3.0',
      new Map([['tview/private-widget-state/zz_termwright_probe.go', digest]]),
    );

    expect(result.changed).toBe(true);
    expect(unit.sourceDigest).toBe(digest);
    for (const framework of registry.frameworks) {
      expect(framework.probe.packageVersion).toMatch(/^v?0\.3\.0$/u);
      expect(framework.certification.adapterVersion).toBe(framework.probe.packageVersion);
      expect(framework.certification.ids).toEqual(
        framework.versions.policy === 'capability'
          ? [
              `${framework.id}@${
                framework.certification.strategy === 'compile-and-behavioral-capability'
                  ? 'compile-capability'
                  : 'runtime-capability'
              }/${framework.probe.packageVersion}`,
            ]
          : framework.versions.verified.map(
              (version) => `${framework.id}@${version}/${framework.probe.packageVersion}`,
            ),
      );
      if (framework.annotations !== null) {
        expect(framework.annotations.packageVersion).toMatch(/^v?0\.3\.0$/u);
      }
    }

    expect(
      synchronizeCompatibilityRegistry(
        registry,
        '0.3.0',
        new Map([['tview/private-widget-state/zz_termwright_probe.go', digest]]),
      ),
    ).toEqual({ changed: false, drift: [] });
  });

  it('fails closed when an owned-unit mapping no longer identifies a registry unit', () => {
    const registry = JSON.parse(readFileSync('compatibility/registry.json', 'utf8'));

    expect(() =>
      synchronizeCompatibilityRegistry(
        registry,
        '0.3.0',
        new Map([['tview/private-widget-state/stale_target.go', 'sha256:stale']]),
      ),
    ).toThrow(
      'compatibility/registry.json: configured added units not found: tview/private-widget-state/stale_target.go',
    );
  });
});
