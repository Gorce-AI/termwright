#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const registryUrl = new URL('../compatibility/registry.json', import.meta.url);
const outputUrl = new URL('../compatibility/framework-semantic-completeness.json', import.meta.url);

/**
 * Build the machine-readable answer to "what does this adapter actually
 * know?" from the same registry that freezes the session contract.
 *
 * This intentionally contains no second capability vocabulary. It is a
 * projection: changing an adapter claim without regenerating this file makes
 * CI red, while changing this generator cannot create a runtime guarantee.
 */
export function buildSemanticCompletenessReport(registry) {
  if (registry?.schemaVersion !== 5 || !Array.isArray(registry.frameworks)) {
    throw new TypeError('semantic completeness requires compatibility registry schemaVersion 5');
  }

  return {
    schemaVersion: 1,
    generatedFrom: {
      registry: 'compatibility/registry.json',
      registrySchemaVersion: registry.schemaVersion,
    },
    frameworks: registry.frameworks.map((framework) => ({
      frameworkId: framework.id,
      frameworkPackage: framework.frameworkPackage,
      exactConfigurations: framework.instrumentation.variants.map((variant) => ({
        id: variant.id,
        frameworkVersion: variant.frameworkVersion,
        modules: variant.modules.map(({ name, version, optional }) => ({
          name,
          version,
          ...(optional === undefined ? {} : { optional }),
        })),
      })),
      upstreamTruth: {
        identityKind: framework.probe.identityKind,
        probeFacts: [...framework.probe.capabilities],
        adapterFacts: [...framework.probe.adapterCapabilities],
      },
      capturedAutomatically: [...framework.capabilityGraph.automatic],
      portableContract: {
        automatic: [...framework.capabilityGraph.automatic],
        applicationIntegrated: framework.capabilityGraph.applicationIntegrated.map((entry) => ({
          providerType: entry.providerType,
          providerFacts: [...entry.providerCapabilities],
          sessionCapabilities: [...entry.capabilities],
          sdks: [...entry.sdks],
        })),
        input: framework.capabilityGraph.input.map((entry) => ({
          capability: entry.capability,
          producerFacts: [...entry.producerFacts],
          providerAlternatives: entry.providerAlternatives.map((provider) => ({
            providerType: provider.providerType,
            providerFacts: [...provider.providerCapabilities],
            sdks: [...provider.sdks],
          })),
          runtimePrerequisites: [...entry.runtimePrerequisites],
        })),
        unsupported: [...framework.capabilityGraph.unsupported],
      },
      extendedOrDiagnostic: {
        annotations: framework.annotations === null
          ? null
          : {
              package: framework.annotations.package,
              apis: [...framework.annotations.apis],
            },
        producerFactsNotPromotedToAutomaticSessionCapabilities: producerFactsNotPromoted(framework),
      },
      applicationProvidersCanAdd: framework.capabilityGraph.applicationIntegrated.map((entry) => ({
        providerType: entry.providerType,
        facts: [...entry.providerCapabilities],
        sessionCapabilities: [...entry.capabilities],
      })),
      remainsUnknowableAutomatically: [...framework.limitations],
      executableClaims: framework.capabilityGraph.claims.map((claim) => ({
        id: claim.id,
        files: [...claim.files],
      })),
    })),
  };
}

function producerFactsNotPromoted(framework) {
  const automatic = new Set(framework.capabilityGraph.automatic);
  const promotedByName = new Map([
    ['stable-identity', 'stable-identity'],
    ['intended-rect', 'intended-geometry'],
    ['visible-rect', 'clipped-geometry'],
    ['paint-order', 'render-order'],
    ['tree', 'semantic-tree'],
    ['render-revisions', 'paired-revisions'],
  ]);
  return [...framework.probe.capabilities, ...framework.probe.adapterCapabilities]
    .filter((fact, index, all) => all.indexOf(fact) === index)
    .filter((fact) => {
      const capability = promotedByName.get(fact);
      return capability === undefined || !automatic.has(capability);
    });
}

function canonical(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function main() {
  const registry = JSON.parse(await readFile(registryUrl, 'utf8'));
  const expected = canonical(buildSemanticCompletenessReport(registry));
  if (process.argv.includes('--write')) {
    await writeFile(outputUrl, expected);
    process.stdout.write('wrote compatibility/framework-semantic-completeness.json\n');
    return;
  }
  const actual = await readFile(outputUrl, 'utf8').catch(() => '');
  if (actual !== expected) {
    throw new Error('framework semantic completeness report drifted; run node scripts/generate-semantic-completeness.mjs --write');
  }
  process.stdout.write(`semantic completeness: ${registry.frameworks.length} exact adapter reports, zero drift\n`);
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  await main();
}
