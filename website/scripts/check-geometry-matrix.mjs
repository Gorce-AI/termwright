import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { isDirectExecution } from '../../scripts/is-direct-execution.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const pagePath = resolve(here, '../src/content/docs/reference/geometry-visibility.md');
const registryPath = resolve(here, '../../compatibility/registry.json');
const graphPath = resolve(here, '../../clients/test-vectors/capability-graph.json');
const start = '<!-- geometry-matrices:start -->';
const end = '<!-- geometry-matrices:end -->';
const rank = { automatic: 0, 'application-integrated': 1, unsupported: 2 };
const weakest = (values) =>
  values.reduce((result, value) => (rank[value] > rank[result] ? value : result), 'automatic');
const strongest = (values) =>
  values.reduce((result, value) => (rank[value] < rank[result] ? value : result), 'unsupported');

function sessionAvailability(row, capability) {
  if (row.capabilityGraph.automatic.includes(capability)) return 'automatic';
  if (
    row.capabilityGraph.applicationIntegrated.some((entry) =>
      entry.capabilities.includes(capability),
    )
  )
    return 'application-integrated';
  if (row.capabilityGraph.input.some((entry) => entry.capability === capability))
    return 'automatic';
  return 'unsupported';
}

function producerAvailability(row, id) {
  if (id.startsWith('adapter.'))
    return row.probe.adapterCapabilities.includes(id.slice(8)) ? 'automatic' : 'unsupported';
  if (id.startsWith('probe.'))
    return row.probe.capabilities.includes(id.slice(6)) ? 'automatic' : 'unsupported';
  if (id.startsWith('provider.'))
    return [
      ...row.capabilityGraph.applicationIntegrated,
      ...row.capabilityGraph.input.flatMap((entry) => entry.providerAlternatives),
    ].some((entry) => entry.providerCapabilities.includes(id.slice(9)))
      ? 'application-integrated'
      : 'unsupported';
  if (id.startsWith('terminal.')) return 'automatic';
  return undefined;
}

function availability(row, id, graph, visiting = new Set()) {
  if (id.startsWith('session.')) return sessionAvailability(row, id.slice(8));
  const producer = producerAvailability(row, id);
  if (producer !== undefined) return producer;
  if (id.startsWith('runtime.')) return 'automatic';
  if (visiting.has(id)) throw new Error(`capability graph cycle at ${id}`);
  visiting.add(id);
  const incoming = graph.edges.filter(
    (edge) => edge.to === id && (edge.kind === 'requires' || edge.kind === 'requires-any'),
  );
  const required = incoming
    .filter((edge) => edge.kind === 'requires')
    .map((edge) => availability(row, edge.from, graph, new Set(visiting)));
  const alternatives = incoming
    .filter((edge) => edge.kind === 'requires-any')
    .map((edge) => availability(row, edge.from, graph, new Set(visiting)));
  const result = weakest([
    ...(required.length === 0 ? ['automatic'] : required),
    ...(alternatives.length === 0 ? [] : [strongest(alternatives)]),
  ]);
  visiting.delete(id);
  return result;
}

const publicColumns = [
  ['Role locators', 'public.locator.semantic-query'],
  ['Viewport visibility', 'public.condition.visible'],
  ['Click by locator', 'public.action.click'],
  ['Focus by locator', 'public.action.focus'],
  ['Type by locator', 'public.action.type'],
];

function userFacingAvailability(value) {
  if (value === 'automatic') return 'Yes';
  if (value === 'application-integrated') return 'Application setup';
  return 'No';
}

export function renderGeometryPage(page, registry, graph) {
  const publicRows = registry.frameworks.map(
    (row) =>
      `| ${row.name} | ${publicColumns
        .map(([, id]) => userFacingAvailability(availability(row, id, graph)))
        .join(' | ')} |`,
  );

  const generated = [
    start,
    '## Framework support',
    '',
    'This table is generated from the integration registry. “Application setup” links the framework integration to pointer or focus behavior already implemented by the application.',
    '',
    `| Framework | ${publicColumns.map(([title]) => title).join(' | ')} |`,
    `| --- | ${publicColumns.map(() => '---').join(' | ')} |`,
    ...publicRows,
    end,
  ].join('\n');

  const begin = page.indexOf(start);
  const finish = page.indexOf(end);
  if (begin < 0 || finish < begin)
    throw new Error('geometry page is missing generated matrix markers');
  return page.slice(0, begin) + generated + page.slice(finish + end.length);
}

async function main() {
  const registry = JSON.parse(await readFile(registryPath, 'utf8'));
  const graph = JSON.parse(await readFile(graphPath, 'utf8'));
  const page = await readFile(pagePath, 'utf8');
  const rendered = renderGeometryPage(page, registry, graph);
  if (process.argv.includes('--write')) {
    await writeFile(pagePath, rendered);
    console.log('generated capability graph matrices from compatibility/registry.json');
  } else if (page !== rendered) {
    throw new Error(
      'capability graph matrices drifted; run `pnpm --dir website generate:geometry`',
    );
  } else {
    console.log('capability graph matrices match compatibility/registry.json');
  }
}

if (isDirectExecution(import.meta.url)) await main();
