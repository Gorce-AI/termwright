import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { renderGeometryPage } from '../website/scripts/check-geometry-matrix.mjs';

const pageUrl = new URL(
  '../website/src/content/docs/reference/geometry-visibility.md',
  import.meta.url,
);
const registryUrl = new URL('../compatibility/registry.json', import.meta.url);
const graphUrl = new URL('../clients/test-vectors/capability-graph.json', import.meta.url);

describe('generated geometry and certification reference', () => {
  it('renders certification ids from the supplied compatibility registry without changing prose', async () => {
    const page = await readFile(pageUrl, 'utf8');
    const registry = JSON.parse(await readFile(registryUrl, 'utf8'));
    const graph = JSON.parse(await readFile(graphUrl, 'utf8'));
    const candidate = structuredClone(registry);
    const opentui = candidate.frameworks.find((entry) => entry.id === 'opentui');
    const suppliedId = `opentui@synthetic-render-test/${opentui.certification.adapterVersion}`;
    expect(opentui.certification.ids).not.toContain(suppliedId);
    opentui.certification.ids.push(suppliedId);

    const rendered = renderGeometryPage(page, candidate, graph);
    const startMarker = '<!-- geometry-matrices:start -->';
    const endMarker = '<!-- geometry-matrices:end -->';

    expect(rendered).toContain(opentui.certification.ids.join('<br>'));
    expect(rendered.slice(0, rendered.indexOf(startMarker))).toBe(
      page.slice(0, page.indexOf(startMarker)),
    );
    expect(rendered.slice(rendered.indexOf(endMarker) + endMarker.length)).toBe(
      page.slice(page.indexOf(endMarker) + endMarker.length),
    );
    expect(renderGeometryPage(rendered, candidate, graph)).toBe(rendered);
  });

  it('fails closed when the generated section markers are absent', async () => {
    const registry = JSON.parse(await readFile(registryUrl, 'utf8'));
    const graph = JSON.parse(await readFile(graphUrl, 'utf8'));
    expect(() => renderGeometryPage('# incomplete\n', registry, graph)).toThrow(/markers/u);
  });
});
