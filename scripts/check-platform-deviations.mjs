import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { isDirectExecution } from './is-direct-execution.mjs';
import ts from 'typescript';

const registryPath = 'quality/platform-deviations.json';
const applicabilityPath = 'quality/applicability-skips.json';

export function validateExactSkipReferences(registry, applicability, sources) {
  const references = [];
  for (const deviation of registry.deviations) {
    for (const test of deviation.skipPolicyTests ?? []) {
      references.push({ owner: deviation.id, file: test[0], title: test[1] });
    }
  }
  for (const rule of applicability?.rules ?? []) {
    if (rule.required === true)
      references.push({ owner: rule.id, file: rule.file, title: rule.fullName });
  }
  const leavesByFile = new Map(
    [...sources].map(([file, source]) => [file, literalLeafTitles(source)]),
  );
  const errors = [];
  for (const { owner, file, title } of references) {
    const exactMatches = leavesByFile.get(file)?.filter((leaf) => leaf === title).length ?? 0;
    if (exactMatches === 1) continue;
    if (exactMatches > 1) {
      errors.push(`${owner}: ${file}::${title} matches ${exactMatches} literal leaf tests`);
      continue;
    }
    const otherFiles = [...leavesByFile]
      .filter(([candidate, leaves]) => candidate !== file && leaves.includes(title))
      .map(([candidate]) => candidate);
    errors.push(
      otherFiles.length === 0
        ? `${owner}: ${file}::${title} does not match a literal leaf test`
        : `${owner}: ${file}::${title} exists only in ${otherFiles.join(', ')}`,
    );
  }
  if (errors.length > 0)
    throw new Error(
      `invalid exact skip-policy references:\n${errors.map((error) => `  ${error}`).join('\n')}`,
    );
}

export function literalLeafTitles(source) {
  const titles = [];
  const sourceFile = ts.createSourceFile(
    'candidate.ts',
    source,
    ts.ScriptTarget.Latest,
    false,
    ts.ScriptKind.TSX,
  );
  const testReferences = new Set(['it', 'test']);
  collectTestReferences(sourceFile);
  visit(sourceFile);
  return titles;

  function collectTestReferences(node) {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      ['@termwright/test', '@termwright/test-provider-internal'].includes(node.moduleSpecifier.text)
    ) {
      for (const element of node.importClause?.namedBindings?.elements ?? []) {
        if (
          (element.propertyName?.text ?? element.name.text) === 'it' ||
          (element.propertyName?.text ?? element.name.text) === 'test'
        )
          testReferences.add(element.name.text);
      }
    }
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer !== undefined &&
      ts.isCallExpression(node.initializer) &&
      ts.isPropertyAccessExpression(node.initializer.expression) &&
      node.initializer.expression.name.text === 'resources' &&
      isTestReference(node.initializer.expression.expression)
    ) {
      testReferences.add(node.name.text);
    }
    ts.forEachChild(node, collectTestReferences);
  }

  function visit(node) {
    if (ts.isCallExpression(node) && isLeafCallee(node.expression)) {
      const title = node.arguments[0];
      if (
        title !== undefined &&
        (ts.isStringLiteral(title) || ts.isNoSubstitutionTemplateLiteral(title))
      ) {
        titles.push(title.text);
      }
    }
    ts.forEachChild(node, visit);
  }

  function isLeafCallee(expression) {
    if (isTestReference(expression)) return true;
    return (
      ts.isCallExpression(expression) &&
      ts.isPropertyAccessExpression(expression.expression) &&
      (['each', 'for', 'runIf', 'skipIf'].includes(expression.expression.name.text) ||
        expression.expression.name.text === 'resources') &&
      isTestReference(expression.expression.expression)
    );
  }

  function isTestReference(expression) {
    if (ts.isIdentifier(expression)) return testReferences.has(expression.text);
    if (
      ts.isCallExpression(expression) &&
      ts.isPropertyAccessExpression(expression.expression) &&
      expression.expression.name.text === 'resources'
    ) {
      return isTestReference(expression.expression.expression);
    }
    return (
      ts.isPropertyAccessExpression(expression) &&
      ['concurrent', 'fails', 'only', 'skip', 'todo'].includes(expression.name.text) &&
      isTestReference(expression.expression)
    );
  }
}

export function literalPlatformSkips(source) {
  const skips = [];
  const sourceFile = ts.createSourceFile(
    'candidate.ts',
    source,
    ts.ScriptTarget.Latest,
    false,
    ts.ScriptKind.TSX,
  );
  visit(sourceFile);
  return skips;

  function visit(node) {
    if (
      ts.isCallExpression(node) &&
      ts.isCallExpression(node.expression) &&
      ts.isPropertyAccessExpression(node.expression.expression) &&
      node.expression.expression.name.text === 'skipIf'
    ) {
      const title = node.arguments[0];
      const condition = node.expression.arguments[0];
      if (
        (ts.isStringLiteral(title) || ts.isNoSubstitutionTemplateLiteral(title)) &&
        condition !== undefined &&
        ts.isBinaryExpression(condition) &&
        condition.left.getText(sourceFile) === 'process.platform' &&
        (condition.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken ||
          condition.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsEqualsToken) &&
        ts.isStringLiteral(condition.right)
      ) {
        skips.push({ title: title.text, condition: condition.getText(sourceFile) });
      }
    }
    ts.forEachChild(node, visit);
  }
}

async function main() {
  const registry = JSON.parse(await readFile(registryPath, 'utf8'));
  if (registry.version !== 1 || !Array.isArray(registry.deviations))
    throw new Error('invalid platform deviation registry');

  const files = [];
  for (const root of ['packages', 'clients', 'compatibility', 'examples'])
    await collectSources(root, files);
  const sources = new Map();
  const observed = new Map();
  for (const file of files) {
    const source = await readFile(file, 'utf8');
    const portableFile = file.replaceAll('\\', '/');
    sources.set(portableFile, source);
    for (const skip of literalPlatformSkips(source))
      observed.set(`${portableFile}::${skip.title}`, skip.condition);
  }

  const registered = new Map();
  const ids = new Set();
  for (const deviation of registry.deviations) {
    for (const field of [
      'id',
      'capability',
      'predicate',
      'category',
      'reason',
      'evidence',
      'issueOrAdr',
      'removalCondition',
      'owner',
      'revalidate',
    ]) {
      if (typeof deviation[field] !== 'string' || deviation[field].length === 0)
        throw new Error(`${deviation.id ?? '<unknown>'}: missing ${field}`);
    }
    if (ids.has(deviation.id)) throw new Error(`duplicate deviation id ${deviation.id}`);
    ids.add(deviation.id);
    if (!Array.isArray(deviation.tests) || deviation.tests.length === 0)
      throw new Error(`${deviation.id}: no tests`);
    for (const test of deviation.tests) {
      if (
        !Array.isArray(test) ||
        test.length !== 2 ||
        !test.every((entry) => typeof entry === 'string' && entry.length > 0)
      ) {
        throw new Error(`${deviation.id}: invalid test reference`);
      }
      const key = `${test[0]}::${test[1]}`;
      if (registered.has(key))
        throw new Error(`${key} is registered by both ${registered.get(key)} and ${deviation.id}`);
      registered.set(key, deviation.id);
    }
    if (
      deviation.skipPolicyTests != null &&
      (!Array.isArray(deviation.skipPolicyTests) ||
        !deviation.skipPolicyTests.every(
          (test) =>
            Array.isArray(test) &&
            test.length === 2 &&
            test.every((entry) => typeof entry === 'string' && entry.length > 0),
        ))
    ) {
      throw new Error(`${deviation.id}: invalid exact skip-policy references`);
    }
  }

  const applicability = await optionalJson(applicabilityPath);
  if (
    applicability !== undefined &&
    (applicability.version !== 1 || !Array.isArray(applicability.rules))
  ) {
    throw new Error('invalid applicability skip registry');
  }
  validateExactSkipReferences(registry, applicability, sources);

  const missing = [...observed.keys()].filter((key) => !registered.has(key));
  const stale = [...registered.keys()].filter((key) => !observed.has(key));
  if (missing.length > 0 || stale.length > 0) {
    const parts = [];
    if (missing.length > 0)
      parts.push(`unregistered platform skips:\n${missing.map((key) => `  ${key}`).join('\n')}`);
    if (stale.length > 0)
      parts.push(`stale deviation entries:\n${stale.map((key) => `  ${key}`).join('\n')}`);
    throw new Error(parts.join('\n'));
  }
  console.log(
    `platform deviations: ${ids.size} reasons, ${observed.size} explicit skips, zero drift`,
  );
}

async function optionalJson(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  }
}

async function collectSources(path, output) {
  for (const entry of await readdir(path, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'target') continue;
    const child = join(path, entry.name);
    if (entry.isDirectory()) await collectSources(child, output);
    else if (/\.(?:ts|tsx|js|mjs)$/u.test(entry.name)) output.push(child);
  }
}

if (isDirectExecution(import.meta.url)) await main();
