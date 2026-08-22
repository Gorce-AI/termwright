import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const pagePath = resolve(here, '../src/content/docs/reference/geometry-visibility.md');
const registryPath = resolve(here, '../../compatibility/registry.json');
const graphPath = resolve(here, '../../clients/test-vectors/capability-graph.json');
const start = '<!-- geometry-matrices:start -->';
const end = '<!-- geometry-matrices:end -->';
const registry = JSON.parse(await readFile(registryPath, 'utf8'));
const graph = JSON.parse(await readFile(graphPath, 'utf8'));
const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
const rank = { automatic: 0, 'application-integrated': 1, unsupported: 2 };
const weakest = (values) => values.reduce((result, value) => rank[value] > rank[result] ? value : result, 'automatic');
const strongest = (values) => values.reduce((result, value) => rank[value] < rank[result] ? value : result, 'unsupported');

function sessionAvailability(row, capability) {
  if (row.capabilityGraph.automatic.includes(capability)) return 'automatic';
  if (row.capabilityGraph.applicationIntegrated.some((entry) => entry.capabilities.includes(capability))) return 'application-integrated';
  if (row.capabilityGraph.input.some((entry) => entry.capability === capability)) return 'automatic';
  return 'unsupported';
}

function producerAvailability(row, id) {
  if (id.startsWith('adapter.')) return row.probe.adapterCapabilities.includes(id.slice(8)) ? 'automatic' : 'unsupported';
  if (id.startsWith('probe.')) return row.probe.capabilities.includes(id.slice(6)) ? 'automatic' : 'unsupported';
  if (id.startsWith('provider.')) return [
    ...row.capabilityGraph.applicationIntegrated,
    ...row.capabilityGraph.input.flatMap((entry) => entry.providerAlternatives),
  ].some((entry) => entry.providerCapabilities.includes(id.slice(9))) ? 'application-integrated' : 'unsupported';
  if (id.startsWith('terminal.')) return 'automatic';
  return undefined;
}

function availability(row, id, visiting = new Set()) {
  if (id.startsWith('session.')) return sessionAvailability(row, id.slice(8));
  const producer = producerAvailability(row, id);
  if (producer !== undefined) return producer;
  if (id.startsWith('runtime.')) return 'automatic';
  if (visiting.has(id)) throw new Error(`capability graph cycle at ${id}`);
  visiting.add(id);
  const incoming = graph.edges.filter((edge) => edge.to === id && (edge.kind === 'requires' || edge.kind === 'requires-any'));
  const required = incoming.filter((edge) => edge.kind === 'requires').map((edge) => availability(row, edge.from, new Set(visiting)));
  const alternatives = incoming.filter((edge) => edge.kind === 'requires-any').map((edge) => availability(row, edge.from, new Set(visiting)));
  const result = weakest([
    ...(required.length === 0 ? ['automatic'] : required),
    ...(alternatives.length === 0 ? [] : [strongest(alternatives)]),
  ]);
  visiting.delete(id);
  return result;
}

const evidenceColumns = [
  ['Semantic tree', 'semantic-tree'], ['Stable identity', 'stable-identity'],
  ['Intended geometry', 'intended-geometry'], ['Clipped geometry', 'clipped-geometry'],
  ['Painted region', 'painted-region'], ['Pointer region', 'pointer-geometry'],
  ['Hit testing', 'pointer-hit-testing'], ['Focus', 'focus'], ['Scroll', 'scroll'],
  ['Render order', 'render-order'],
];
const publicColumns = [
  ['Semantic query', 'public.locator.semantic-query'], ['Visible', 'public.condition.visible'],
  ['Click', 'public.action.click'], ['Hover', 'public.action.hover'], ['Drag', 'public.action.drag'],
  ['Focus', 'public.action.focus'], ['Activate', 'public.action.activate'], ['Type', 'public.action.type'],
  ['Fill', 'public.action.fill'], ['Checkpoint', 'public.checkpoint'],
];
const evidenceRows = registry.frameworks.map((row) =>
  `| ${row.name} | ${evidenceColumns.map(([, capability]) => sessionAvailability(row, capability)).join(' | ')} |`,
);
const publicRows = registry.frameworks.map((row) =>
  `| ${row.name} | ${publicColumns.map(([, id]) => availability(row, id)).join(' | ')} |`,
);
const certificationRows = registry.frameworks.map((row) =>
  `| ${row.name} | ${row.certification.ids.join('<br>')} | ${row.certification.strategy} | ${row.certification.checksumSources.length === 0 ? 'native hook' : row.certification.checksumSources.map((source) => `\`${source}\``).join('<br>')} |`,
);
const providerRows = registry.frameworks.map((row) => {
  const integrations = [
    ...row.capabilityGraph.applicationIntegrated,
    ...row.capabilityGraph.input.flatMap((entry) => entry.providerAlternatives.map((alternative) => ({
      ...alternative,
      capabilities: [entry.capability],
    }))),
  ];
  const providerTypes = [...new Set(integrations.map((item) => item.providerType))];
  const capabilities = [...new Set(integrations.flatMap((item) => item.capabilities))];
  const sdks = [...new Set(integrations.flatMap((item) => item.sdks))];
  return `| ${row.name} | ${providerTypes.join(', ') || 'none'} | ${capabilities.join(', ') || 'none'} | ${sdks.map((sdk) => `\`${sdk}\``).join(', ') || 'none'} |`;
});
const claimRows = registry.frameworks.map((row) =>
  `| ${row.name} | ${row.capabilityGraph.claims.map((claim) => `\`${claim.id}\``).join('<br>')} | ${row.capabilityGraph.claims.flatMap((claim) => claim.files).filter((file, index, files) => files.indexOf(file) === index).map((file) => `\`${file}\``).join('<br>')} |`,
);
const runtimeRows = registry.frameworks.flatMap((row) => row.capabilityGraph.input.flatMap((input) =>
  input.runtimePrerequisites.map((prerequisite) => {
    const remediation = nodeById.get(`runtime.${prerequisite}`)?.remediation;
    if (remediation === undefined) throw new Error(`missing generated remediation for runtime.${prerequisite}`);
    return `- **${row.name} — ${input.capability} / ${prerequisite}:** ${remediation.message}`;
  }),
));

const generated = [
  start,
  '## Framework capability graph', '',
  'Every value below is generated from the executable capability graph and the exact certification row. `automatic`, `application-integrated`, and `unsupported` describe authoritative evidence sources; runtime prerequisites are separate.', '',
  `| Framework | ${evidenceColumns.map(([title]) => title).join(' | ')} |`,
  `| --- | ${evidenceColumns.map(() => '---').join(' | ')} |`, ...evidenceRows, '',
  '## Derived public surface', '',
  'Public availability is computed by traversing the same graph used by certification. Diagnostic evidence never unlocks an action.', '',
  `| Framework | ${publicColumns.map(([title]) => title).join(' | ')} |`,
  `| --- | ${publicColumns.map(() => '---').join(' | ')} |`, ...publicRows, '',
  '## Exact certifications', '',
  '| Framework | Certification ID | Instrumentation policy | Checksum source of truth |',
  '| --- | --- | --- | --- |', ...certificationRows, '',
  '## Application-integrated providers', '',
  '| Framework | Accepted provider types | Extended session capabilities | SDKs |',
  '| --- | --- | --- | --- |', ...providerRows, '',
  '## Executable conformance claims', '',
  '| Framework | Mandatory claim IDs | Executable files |',
  '| --- | --- | --- |', ...claimRows, '',
  '### Runtime prerequisites and generated remediation', '', ...runtimeRows,
  end,
].join('\n');

const page = await readFile(pagePath, 'utf8');
const begin = page.indexOf(start);
const finish = page.indexOf(end);
if (begin < 0 || finish < begin) throw new Error('geometry page is missing generated matrix markers');
const actual = page.slice(begin, finish + end.length);
if (process.argv.includes('--write')) {
  await writeFile(pagePath, page.slice(0, begin) + generated + page.slice(finish + end.length));
  console.log('generated capability graph matrices from compatibility/registry.json');
} else if (actual !== generated) {
  throw new Error('capability graph matrices drifted; run `pnpm --dir website generate:geometry`');
} else {
  console.log('capability graph matrices match compatibility/registry.json');
}
