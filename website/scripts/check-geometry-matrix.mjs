import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const pagePath = resolve(here, '../src/content/docs/reference/geometry-visibility.md');
const registryPath = resolve(here, '../../compatibility/registry.json');
const start = '<!-- geometry-matrices:start -->';
const end = '<!-- geometry-matrices:end -->';
const registry = JSON.parse(await readFile(registryPath, 'utf8'));

const generic = {
  id: 'generic',
  name: 'Generic grid',
  probe: { identityKind: 'none' },
  geometry: {
    displayed: 'automatic',
    intendedRect: 'automatic',
    visibleRect: 'automatic',
    hitTest: 'automatic',
    runtimePreconditions: {
      pointerActions: ['The application enables terminal mouse reporting before pointer input is sent.'],
    },
    reason: 'Grid matches are terminal cells. Exact pointer delivery additionally requires application mouse reporting.',
  },
};
const rows = [generic, ...registry.frameworks];
const rank = { automatic: 0, 'application-integrated': 1, unsupported: 2 };
const weakest = (...values) => values.reduce(
  (result, value) => rank[value] > rank[result] ? value : result,
  'automatic',
);
const operations = (row) => {
  const geometry = row.geometry;
  return [
    'automatic',
    geometry.hitTest,
    'automatic',
    'automatic',
    geometry.displayed,
    geometry.displayed,
    weakest(geometry.displayed, geometry.visibleRect),
    weakest(geometry.intendedRect, geometry.visibleRect),
    weakest(geometry.intendedRect, geometry.visibleRect),
    geometry.hitTest,
    geometry.intendedRect,
    geometry.intendedRect,
    geometry.visibleRect,
  ];
};

const observationRows = rows.map((row) =>
  `| ${row.name} | ${row.probe.identityKind} | ${row.geometry.displayed} | ${row.geometry.intendedRect} | ${row.geometry.visibleRect} | ${row.geometry.hitTest} | ${row.geometry.reason} |`,
);
const operationRows = rows.map((row) => `| ${row.name} | ${operations(row).join(' | ')} |`);
const certificationRows = registry.frameworks.map((row) =>
  `| ${row.name} | ${row.certification.ids.join('<br>')} | ${row.certification.strategy} | ${row.certification.checksumSources.length === 0 ? 'native hook' : row.certification.checksumSources.map((source) => `\`${source}\``).join('<br>')} |`,
);
const providerRows = registry.frameworks.map((row) =>
  `| ${row.name} | ${row.applicationProviders.acceptedTypes.join(', ') || 'none'} | ${row.applicationProviders.extendableCapabilities.join(', ') || 'none'} | ${row.applicationProviders.sdks.map((sdk) => `\`${sdk}\``).join(', ') || 'none'} |`,
);
const conformanceRows = registry.frameworks.map((row) =>
  `| ${row.name} | ${row.conformance.areas.join(', ')} | ${row.conformance.fixtures.map((fixture) => `\`${fixture}\``).join('<br>')} |`,
);
const preconditions = rows.flatMap((row) =>
  Object.entries(row.geometry.runtimePreconditions).flatMap(([observation, values]) =>
    values.map((value) => `- **${row.name} — ${observation}:** ${value}`),
  ),
);
const terminalPreconditions = registry.frameworks.flatMap((row) =>
  row.terminalPrerequisites.flatMap((prerequisite) => prerequisite.requirements.map((requirement) =>
    `- **${row.name} — ${prerequisite.capability}:** ${requirement}`,
  )),
);
const generated = [
  start,
  '## Framework capability matrix',
  '',
  'The compatibility registry classifies facts as `automatic`, `application-integrated`, or `unsupported`. Runtime requirements are listed separately below.',
  '',
  '| Framework | Identity | Displayed | Intended rect | Visible rect | Exact hit test | Why |',
  '| --- | --- | --- | --- | --- | --- | --- |',
  ...observationRows,
  '',
  '## Action and assertion matrix',
  '',
  '| Framework | Keyboard | Pointer | Attached | Detached | Displayed | Hidden | Visible | Offscreen | In viewport | Receives pointer | Bounds | Spatial | Cell snapshot |',
  '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  ...operationRows,
  '',
  '## Exact certifications',
  '',
  '| Framework | Certification ID | Instrumentation policy | Checksum source of truth |',
  '| --- | --- | --- | --- |',
  ...certificationRows,
  '',
  '## Application-integrated capability providers',
  '',
  '| Framework | Accepted provider types | Extendable capabilities | SDKs |',
  '| --- | --- | --- | --- |',
  ...providerRows,
  '',
  '## Executable conformance coverage',
  '',
  '| Framework | Covered areas | Real fixtures |',
  '| --- | --- | --- |',
  ...conformanceRows,
  '',
  '### Runtime preconditions',
  '',
  ...preconditions,
  ...terminalPreconditions,
  end,
].join('\n');

const page = await readFile(pagePath, 'utf8');
const begin = page.indexOf(start);
const finish = page.indexOf(end);
if (begin < 0 || finish < begin) throw new Error('geometry page is missing generated matrix markers');
const actual = page.slice(begin, finish + end.length);
if (process.argv.includes('--write')) {
  await writeFile(pagePath, page.slice(0, begin) + generated + page.slice(finish + end.length));
  console.log('generated geometry and operation matrices from compatibility/registry.json');
} else if (actual !== generated) {
  throw new Error('geometry matrices drifted; run `pnpm --dir website generate:geometry`');
} else {
  console.log('geometry and operation matrices match compatibility/registry.json');
}
