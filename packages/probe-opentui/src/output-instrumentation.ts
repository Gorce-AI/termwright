/** Structural OpenTUI constructor instrumentation for a transparent local feed. */

import { parse, type Node } from 'acorn';
import {
  MARKER_SINK_FEED_WRITE_SYMBOL,
  MARKER_SINK_SYMBOL,
  MARKER_SINK_TARGET_SYMBOL,
} from './sink.js';

export const OUTPUT_INSTRUMENTATION_SYMBOL = Symbol.for(
  'termwright.opentui.local-feed-instrumentation.v1',
);

/** Any generated JS module in the package root; no chunk basename knowledge. */
export const OPENTUI_MODULE_PATTERN = /@opentui[\\/]core[\\/][^\\/]+\.js$/u;

type AstNode = Node & Record<string, unknown>;

interface ConstructorAnchors {
  readonly stdoutStatementEnd: number;
  readonly identityRightStart: number;
  readonly identityRightEnd: number;
  readonly realWriteRightStart: number;
  readonly realWriteRightEnd: number;
  readonly feedStart: number;
  readonly feedEnd: number;
  readonly remoteStart: number;
  readonly remoteEnd: number;
  readonly stdoutLeaseArguments: readonly (readonly [number, number])[];
  readonly feedWriteStart: number;
  readonly feedWriteEnd: number;
  readonly feedWriteArgumentsStart: number;
  readonly feedWriteArgumentsEnd: number;
}

/**
 * Instrument a generated OpenTUI module by semantic AST shape, never filename
 * or exact source bytes. Returns undefined unless exactly one renderer
 * constructor exposes every required invariant in the expected order.
 */
export function instrumentOpenTuiOutput(
  source: string,
  frameworkVersion: string,
  token: string,
): string | undefined {
  if (token.length === 0) return undefined;
  let root: AstNode;
  try {
    root = parse(source, { ecmaVersion: 'latest', sourceType: 'module' }) as unknown as AstNode;
  } catch {
    return undefined;
  }
  const matches: ConstructorAnchors[] = [];
  walk(root, undefined, (node) => {
    if (node.type !== 'MethodDefinition' || node['kind'] !== 'constructor') return;
    const value = node['value'] as AstNode | undefined;
    const body = value?.['body'] as AstNode | undefined;
    if (body?.type !== 'BlockStatement') return;
    const anchors = findConstructorAnchors(body);
    if (anchors !== undefined) matches.push(anchors);
  });
  if (matches.length !== 1) return undefined;
  const anchor = matches[0]!;
  const originalFeed = source.slice(anchor.feedStart, anchor.feedEnd);
  const originalRemote = source.slice(anchor.remoteStart, anchor.remoteEnd);
  const brand = JSON.stringify(Symbol.keyFor(MARKER_SINK_SYMBOL));
  const encodedToken = JSON.stringify(token);
  const target = JSON.stringify(Symbol.keyFor(MARKER_SINK_TARGET_SYMBOL));
  const feedWrite = JSON.stringify(Symbol.keyFor(MARKER_SINK_FEED_WRITE_SYMBOL));
  const identityInsertion = `\n    const __termwrightLocalFeed = globalThis.__termwright_isOpenTuiOutputSink?.(stdout) === true && stdout?.[Symbol.for(${brand})] === ${encodedToken};\n    if (__termwrightLocalFeed) this.stdout = stdout[Symbol.for(${target})];`;
  const feedReplacement = `(__termwrightLocalFeed || (${originalFeed}))`;
  const remoteReplacement = `(__termwrightLocalFeed ? config.remote : (${originalRemote}))`;
  const transformed = splice(source, [
    [anchor.stdoutStatementEnd, anchor.stdoutStatementEnd, identityInsertion],
    [anchor.identityRightStart, anchor.identityRightEnd, 'this.stdout === process.stdout'],
    [
      anchor.realWriteRightStart,
      anchor.realWriteRightEnd,
      `(__termwrightLocalFeed ? this.stdout.write : ${source.slice(anchor.realWriteRightStart, anchor.realWriteRightEnd)})`,
    ],
    [anchor.feedStart, anchor.feedEnd, feedReplacement],
    [anchor.remoteStart, anchor.remoteEnd, remoteReplacement],
    [
      anchor.feedWriteStart,
      anchor.feedWriteEnd,
      `(__termwrightLocalFeed ? stdout[Symbol.for(${feedWrite})](${source.slice(anchor.feedWriteArgumentsStart, anchor.feedWriteArgumentsEnd)}) : ${source.slice(anchor.feedWriteStart, anchor.feedWriteEnd)})`,
    ],
    ...anchor.stdoutLeaseArguments.map(([start, end]) => [start, end, 'this.stdout'] as const),
  ]);
  const sentinel = JSON.stringify(Symbol.keyFor(OUTPUT_INSTRUMENTATION_SYMBOL));
  return `globalThis[Symbol.for(${sentinel})] = Object.freeze({ version: 1, frameworkVersion: ${JSON.stringify(frameworkVersion)}, token: ${encodedToken} });\n${transformed}`;
}

export function outputInstrumentationVersion(token: string): string | undefined {
  const value = (globalThis as Record<PropertyKey, unknown>)[OUTPUT_INSTRUMENTATION_SYMBOL];
  if (value === null || typeof value !== 'object') return undefined;
  const candidate = value as Record<string, unknown>;
  return candidate['version'] === 1 &&
    candidate['token'] === token &&
    typeof candidate['frameworkVersion'] === 'string'
    ? candidate['frameworkVersion']
    : undefined;
}

function findConstructorAnchors(body: AstNode): ConstructorAnchors | undefined {
  const stdoutEnds: number[] = [];
  const identityRights: Array<readonly [number, number]> = [];
  const realWriteRights: Array<readonly [number, number]> = [];
  const feedRanges: Array<readonly [number, number]> = [];
  const remoteRanges: Array<readonly [number, number]> = [];
  const stdoutLeaseGetArguments: Array<readonly [number, number]> = [];
  const stdoutLeaseSetArguments: Array<readonly [number, number]> = [];
  const feedExecutors: AstNode[] = [];
  const feedWrites: Array<readonly [number, number, number, number]> = [];
  if (containsIdentifier(body, '__termwrightLocalFeed')) return undefined;
  walkConstructorScope(body, undefined, (node, parent) => {
    if (
      node.type === 'AssignmentExpression' &&
      memberName(node['left']) === 'stdout' &&
      identifierName(node['right']) === 'stdout' &&
      parent?.type === 'ExpressionStatement'
    )
      stdoutEnds.push(parent.end);
    if (
      node.type === 'AssignmentExpression' &&
      memberName(node['left']) === '_usesProcessStdout' &&
      parent?.type === 'ExpressionStatement'
    ) {
      const right = node['right'] as AstNode | undefined;
      if (isStdoutIdentity(right)) identityRights.push([right!.start, right!.end]);
    }
    if (
      node.type === 'AssignmentExpression' &&
      memberName(node['left']) === 'realStdoutWrite' &&
      parent?.type === 'ExpressionStatement'
    ) {
      const right = node['right'] as AstNode | undefined;
      if (isIdentifierMember(right, 'stdout', 'write'))
        realWriteRights.push([right!.start, right!.end]);
    }
    if (node.type !== 'VariableDeclarator') return;
    const name = identifierName(node['id']);
    if (name === 'useFeedOutput') {
      const init = node['init'] as AstNode | undefined;
      if (
        init !== undefined &&
        containsMember(init, '_usesProcessStdout') &&
        containsIdentifier(init, 'useMemoryBufferedOutput')
      ) {
        feedRanges.push([init.start, init.end]);
      }
    }
    if (name === 'remoteMode') {
      const init = node['init'] as AstNode | undefined;
      if (init === undefined || parent?.type !== 'VariableDeclaration') return;
      if (
        init.type === 'LogicalExpression' &&
        init['operator'] === '??' &&
        isIdentifierMember(init['left'] as AstNode, 'config', 'remote') &&
        containsIdentifier(init, 'useFeedOutput')
      ) {
        remoteRanges.push([init.start, init.end]);
      }
    }
  });
  walkConstructorScope(body, undefined, (node) => {
    if (node.type === 'AssignmentExpression' && memberName(node['left']) === '_detachFeed') {
      const right = node['right'] as AstNode | undefined;
      const callee =
        right?.type === 'CallExpression' ? (right['callee'] as AstNode | undefined) : undefined;
      if (
        callee?.type === 'MemberExpression' &&
        identifierName(callee['object']) === 'feed' &&
        identifierName(callee['property']) === 'onData'
      ) {
        const args = right!['arguments'] as AstNode[] | undefined;
        const callback = args?.length === 1 ? args[0] : undefined;
        const executor = feedPromiseExecutor(callback);
        if (executor !== undefined) feedExecutors.push(executor);
      }
    }
    if (node.type !== 'CallExpression') return;
    const callee = node['callee'] as AstNode | undefined;
    const method =
      callee?.type === 'MemberExpression' ? identifierName(callee['property']) : undefined;
    const receiver =
      callee?.type === 'MemberExpression' ? (callee['object'] as AstNode | undefined) : undefined;
    if (!['get', 'set'].includes(method ?? '') || !isTrackerStreamOwners(receiver)) return;
    const args = node['arguments'] as AstNode[] | undefined;
    const first = args?.[0];
    if (identifierName(first) !== 'stdout') return;
    if (method === 'get' && args?.length === 1)
      stdoutLeaseGetArguments.push([first!.start, first!.end]);
    if (
      method === 'set' &&
      args?.length === 2 &&
      (args[1] as AstNode | undefined)?.type === 'ThisExpression'
    ) {
      stdoutLeaseSetArguments.push([first!.start, first!.end]);
    }
  });
  for (const executor of feedExecutors) {
    walkConstructorScope(executor, undefined, (node) => {
      if (node.type !== 'CallExpression') return;
      const callee = node['callee'] as AstNode | undefined;
      if (callee?.type !== 'MemberExpression' || identifierName(callee['property']) !== 'call')
        return;
      const receiver = callee['object'] as AstNode | undefined;
      if (memberName(receiver) !== 'realStdoutWrite') return;
      const args = node['arguments'] as AstNode[] | undefined;
      if (
        args?.length !== 3 ||
        memberName(args[0]) !== 'stdout' ||
        identifierName(args[1]) !== 'bytes'
      )
        return;
      const completion = args[2];
      if (
        completion?.type !== 'ArrowFunctionExpression' &&
        completion?.type !== 'FunctionExpression'
      )
        return;
      feedWrites.push([node.start, node.end, args[1]!.start, completion.end]);
    });
  }
  const stdoutLeaseArguments = [...stdoutLeaseGetArguments, ...stdoutLeaseSetArguments];
  const feedWrite = feedWrites[0];
  if (
    stdoutEnds.length !== 1 ||
    identityRights.length !== 1 ||
    realWriteRights.length !== 1 ||
    feedRanges.length !== 1 ||
    remoteRanges.length !== 1 ||
    stdoutLeaseGetArguments.length !== 1 ||
    stdoutLeaseSetArguments.length !== 1 ||
    feedExecutors.length !== 1 ||
    feedWrites.length !== 1 ||
    !(
      stdoutEnds[0]! < identityRights[0]![0] &&
      identityRights[0]![1] < realWriteRights[0]![0] &&
      realWriteRights[0]![1] < feedRanges[0]![0] &&
      feedRanges[0]![1] < remoteRanges[0]![0]
    )
  )
    return undefined;
  return {
    stdoutStatementEnd: stdoutEnds[0]!,
    identityRightStart: identityRights[0]![0],
    identityRightEnd: identityRights[0]![1],
    realWriteRightStart: realWriteRights[0]![0],
    realWriteRightEnd: realWriteRights[0]![1],
    feedStart: feedRanges[0]![0],
    feedEnd: feedRanges[0]![1],
    remoteStart: remoteRanges[0]![0],
    remoteEnd: remoteRanges[0]![1],
    stdoutLeaseArguments,
    feedWriteStart: feedWrite![0],
    feedWriteEnd: feedWrite![1],
    feedWriteArgumentsStart: feedWrite![2],
    feedWriteArgumentsEnd: feedWrite![3],
  };
}

function feedPromiseExecutor(callback: AstNode | undefined): AstNode | undefined {
  if (callback?.type !== 'ArrowFunctionExpression' && callback?.type !== 'FunctionExpression')
    return undefined;
  const parameters = callback['params'] as AstNode[] | undefined;
  if (parameters?.length !== 1 || identifierName(parameters[0]) !== 'bytes') return undefined;
  const body = callback['body'] as AstNode | undefined;
  let promise = body;
  if (body?.type === 'BlockStatement') {
    const statements = body['body'] as AstNode[] | undefined;
    const returned =
      statements?.length === 1 && statements[0]?.type === 'ReturnStatement'
        ? (statements[0]['argument'] as AstNode | undefined)
        : undefined;
    promise = returned;
  }
  if (promise?.type !== 'NewExpression' || identifierName(promise['callee']) !== 'Promise')
    return undefined;
  const args = promise['arguments'] as AstNode[] | undefined;
  const executor = args?.length === 1 ? args[0] : undefined;
  if (executor?.type !== 'ArrowFunctionExpression' && executor?.type !== 'FunctionExpression')
    return undefined;
  const executorParameters = executor['params'] as AstNode[] | undefined;
  return executorParameters?.length === 1 && identifierName(executorParameters[0]) === 'resolve'
    ? executor
    : undefined;
}

function memberName(value: unknown): string | undefined {
  if (value === null || typeof value !== 'object') return undefined;
  const node = value as AstNode;
  if (
    node.type !== 'MemberExpression' ||
    (node['object'] as AstNode | undefined)?.type !== 'ThisExpression'
  )
    return undefined;
  return identifierName(node['property']);
}

function isIdentifierMember(value: unknown, object: string, property: string): boolean {
  if (value === null || typeof value !== 'object') return false;
  const node = value as AstNode;
  return (
    node.type === 'MemberExpression' &&
    identifierName(node['object']) === object &&
    identifierName(node['property']) === property
  );
}

function isStdoutIdentity(value: AstNode | undefined): boolean {
  return (
    value?.type === 'BinaryExpression' &&
    value['operator'] === '===' &&
    identifierName(value['left']) === 'stdout' &&
    isIdentifierMember(value['right'], 'process', 'stdout')
  );
}

function isTrackerStreamOwners(value: AstNode | undefined): boolean {
  if (value?.type !== 'MemberExpression' || identifierName(value['property']) !== 'streamOwners')
    return false;
  return identifierName(value['object']) === 'rendererTracker';
}

function containsIdentifier(root: AstNode, name: string): boolean {
  let found = false;
  walk(root, undefined, (node) => {
    if (identifierName(node) === name) found = true;
  });
  return found;
}

function containsMember(root: AstNode, name: string): boolean {
  let found = false;
  walk(root, undefined, (node) => {
    if (memberName(node) === name) found = true;
  });
  return found;
}

function identifierName(value: unknown): string | undefined {
  if (value === null || typeof value !== 'object') return undefined;
  const node = value as AstNode;
  return node.type === 'Identifier' && typeof node['name'] === 'string' ? node['name'] : undefined;
}

function walk(
  node: AstNode,
  parent: AstNode | undefined,
  visit: (node: AstNode, parent: AstNode | undefined) => void,
): void {
  visit(node, parent);
  for (const value of Object.values(node)) {
    if (value === null || typeof value !== 'object') continue;
    if (Array.isArray(value)) {
      for (const child of value) {
        if (
          child !== null &&
          typeof child === 'object' &&
          typeof (child as AstNode).type === 'string'
        )
          walk(child as AstNode, node, visit);
      }
    } else if (typeof (value as AstNode).type === 'string') walk(value as AstNode, node, visit);
  }
}

function walkConstructorScope(
  node: AstNode,
  parent: AstNode | undefined,
  visit: (node: AstNode, parent: AstNode | undefined) => void,
): void {
  visit(node, parent);
  if (
    parent !== undefined &&
    [
      'ArrowFunctionExpression',
      'FunctionExpression',
      'FunctionDeclaration',
      'MethodDefinition',
      'ClassDeclaration',
      'ClassExpression',
    ].includes(node.type)
  )
    return;
  for (const value of Object.values(node)) {
    if (value === null || typeof value !== 'object') continue;
    if (Array.isArray(value)) {
      for (const child of value) {
        if (
          child !== null &&
          typeof child === 'object' &&
          typeof (child as AstNode).type === 'string'
        ) {
          walkConstructorScope(child as AstNode, node, visit);
        }
      }
    } else if (typeof (value as AstNode).type === 'string') {
      walkConstructorScope(value as AstNode, node, visit);
    }
  }
}

function splice(source: string, edits: readonly (readonly [number, number, string])[]): string {
  let output = source;
  for (const [start, end, replacement] of [...edits].sort((a, b) => b[0] - a[0])) {
    output = output.slice(0, start) + replacement + output.slice(end);
  }
  return output;
}
