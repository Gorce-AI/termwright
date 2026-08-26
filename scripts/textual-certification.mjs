import { compareVersions, parseVersion } from './discover-framework-candidates.mjs';

function exactPyPiVersions(registry) {
  const versions = registry.frameworks
    ?.find((entry) => entry.id === 'textual')
    ?.versions?.verified;
  if (!Array.isArray(versions) || versions.length === 0) {
    throw new Error('Textual exact certification list is missing');
  }
  for (const version of versions) {
    const parsed = typeof version === 'string' ? parseVersion(version) : null;
    if (
      parsed === null
      || !/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/u.test(version)
      || ![parsed.major, parsed.minor, parsed.patch].every(Number.isSafeInteger)
    ) throw new Error('Textual exact certification list contains an invalid PyPI version');
  }
  return [...new Set(versions)].sort(compareVersions);
}

export function renderCertifiedTextualVersions(registry) {
  const ordered = exactPyPiVersions(registry);
  return [
    '"""Generated from compatibility/registry.json; do not edit by hand."""',
    '',
    `CERTIFIED_TEXTUAL_VERSIONS = (${ordered.map((version) => JSON.stringify(version)).join(', ')},)`,
    '',
  ].join('\n');
}

export function renderCertifiedTextualPyproject(source, registry) {
  const latest = exactPyPiVersions(registry).at(-1);
  const exactVersion = '(?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*)';
  const block = new RegExp(
    `^\\[project\\.optional-dependencies\\]\\ntextual = \\["textual==${exactVersion}"\\]\\ndev = \\["pytest>=7", "pytest-asyncio>=0\\.21", "textual==${exactVersion}"\\]\\n(?=\\n\\[)`,
    'gmu',
  );
  if ((source.match(block) ?? []).length !== 1) {
    throw new Error('Textual optional dependency table must match the exact certified pin grammar');
  }
  return source.replace(block, [
    '[project.optional-dependencies]',
    `textual = ["textual==${latest}"]`,
    `dev = ["pytest>=7", "pytest-asyncio>=0.21", "textual==${latest}"]`,
    '',
  ].join('\n'));
}
