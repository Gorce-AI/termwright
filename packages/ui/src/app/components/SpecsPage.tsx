import {
  ChevronDown,
  ChevronRight,
  Circle,
  ExternalLink,
  FileCode2,
  FilePlus2,
  Folder,
  FolderOpen,
  Play,
  Search,
  Tags,
} from 'lucide-react';
import { useMemo, useState, type CSSProperties } from 'react';
import type { ExecutionCase, ExecutionStatus } from '../domain/model.js';
import { usePreferences } from '../preferences.js';
import { useTreeNavigation } from '../use-tree-navigation.js';
import { StatusBadge } from './StatusBadge.js';
import { Tooltip } from './Tooltip.js';

interface SpecsPageProps {
  readonly cases: readonly ExecutionCase[];
  readonly projectRoot: string;
  readonly canRun: boolean;
  readonly connected: boolean;
  readonly runBusy: boolean;
  readonly onRun: (targets: readonly string[]) => void;
  readonly onOpenSource: (test: ExecutionCase) => void;
  readonly newTest?: {
    readonly canRecord: boolean;
    readonly onCreateFile: () => void;
    readonly onRecord: () => void;
  };
}

interface SpecFile {
  readonly key: string;
  readonly path: string;
  readonly name: string;
  readonly cases: readonly ExecutionCase[];
  readonly visibleCases: readonly ExecutionCase[];
}

interface SpecDirectory {
  readonly key: string;
  readonly path: string;
  readonly name: string;
  readonly cases: readonly ExecutionCase[];
  readonly files: readonly SpecFile[];
  readonly directories: readonly SpecDirectory[];
}

export function SpecsPage({
  cases,
  projectRoot,
  canRun,
  connected,
  runBusy,
  onRun,
  onOpenSource,
  newTest,
}: SpecsPageProps) {
  const { preferences, updatePreferences } = usePreferences();
  const [query, setQuery] = useState('');
  const [newTestOpen, setNewTestOpen] = useState(false);
  const canonicalTree = useMemo(() => buildTree(cases, projectRoot), [cases, projectRoot]);
  const filteredTree = useMemo(() => filterTree(canonicalTree, query), [canonicalTree, query]);
  const expanded = useMemo(
    () => new Set(preferences.specExpansion ?? defaultExpansion(canonicalTree)),
    [canonicalTree, preferences.specExpansion],
  );
  const forceOpen = query.trim() !== '';
  const rows = useMemo(
    () => specTreeRows(filteredTree, expanded, forceOpen),
    [expanded, filteredTree, forceOpen],
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const collapsed = useMemo(
    () =>
      new Set(
        rows
          .filter((row) => row.hasChildren && !expanded.has(row.id) && !forceOpen)
          .map((row) => row.id),
      ),
    [expanded, forceOpen, rows],
  );
  const parentKeys = useMemo(() => specParentKeys(filteredTree), [filteredTree]);
  const navigation = useTreeNavigation({
    rows,
    selectedId,
    collapsed,
    onSelect: setSelectedId,
    onCollapsed: (next) =>
      updatePreferences({ specExpansion: parentKeys.filter((key) => !next.has(key)) }),
  });
  const runnable = useMemo(() => cases.filter(runnableCase), [cases]);
  const canStart = canRun && connected && !runBusy;
  const toggle = (key: string) => {
    const next = new Set(expanded);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    updatePreferences({ specExpansion: [...next] });
  };

  return (
    <section className="tw-specs-page">
      <div className="tw-page-intro tw-catalog-intro">
        <div>
          <h2>Test catalog</h2>
          <p>Select a directory, file, or case to run.</p>
          <SpecCounters cases={cases} />
        </div>
        <div className="tw-spec-actions">
          {newTest === undefined ? null : (
            <div className="tw-new-test">
              <button
                type="button"
                aria-haspopup="menu"
                aria-expanded={newTestOpen}
                disabled={runBusy}
                onClick={() => setNewTestOpen((open) => !open)}
              >
                <FilePlus2 aria-hidden="true" size={15} /> New test{' '}
                <ChevronDown aria-hidden="true" size={13} />
              </button>
              {newTestOpen ? (
                <div role="menu" aria-label="New test options">
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setNewTestOpen(false);
                      newTest.onCreateFile();
                    }}
                  >
                    <FileCode2 aria-hidden="true" size={14} /> Create file
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    disabled={!newTest.canRecord}
                    onClick={() => {
                      setNewTestOpen(false);
                      newTest.onRecord();
                    }}
                  >
                    <Circle aria-hidden="true" size={12} fill="currentColor" /> Record test
                  </button>
                </div>
              ) : null}
            </div>
          )}
          <Tooltip
            label={`Run all ${runnable.length} cases in the current CLI scope`}
            disabledReason={runDisabledReason(canRun, connected, runBusy)}
          >
            <button
              className="tw-primary-button"
              type="button"
              disabled={!canStart || runnable.length === 0}
              onClick={() => onRun([])}
            >
              <Play aria-hidden="true" size={16} /> Run all {runnable.length}
            </button>
          </Tooltip>
        </div>
      </div>
      <label className="tw-search-box">
        <Search aria-hidden="true" size={16} />
        <span className="sr-only">Search specs</span>
        <input
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
          placeholder="Search cases, features, tags or files"
        />
      </label>
      <div
        className="tw-spec-files"
        role="tree"
        aria-label="Test catalog hierarchy"
        onKeyDown={navigation.onKeyDown}
      >
        {filteredTree.directories.map((directory) => (
          <DirectoryRow
            key={directory.key}
            directory={directory}
            depth={0}
            expanded={expanded}
            forceOpen={forceOpen}
            selectedId={navigation.activeId}
            item={navigation.item}
            canStart={canStart}
            disabledReason={runDisabledReason(canRun, connected, runBusy)}
            onToggle={toggle}
            onRun={onRun}
            onOpenSource={onOpenSource}
          />
        ))}
        {filteredTree.files.map((file) => (
          <FileRow
            key={file.key}
            file={file}
            depth={0}
            expanded={expanded}
            forceOpen={forceOpen}
            selectedId={navigation.activeId}
            item={navigation.item}
            canStart={canStart}
            disabledReason={runDisabledReason(canRun, connected, runBusy)}
            onToggle={toggle}
            onRun={onRun}
            onOpenSource={onOpenSource}
          />
        ))}
        {filteredTree.directories.length === 0 && filteredTree.files.length === 0 ? (
          <div className="tw-page-empty">
            <Search aria-hidden="true" />
            <strong>No matching owned tests</strong>
          </div>
        ) : null}
      </div>
      {runBusy ? (
        <p className="tw-run-busy-note" role="status">
          A run is active. Start controls are locked until it ends; use Stop in Runner.
        </p>
      ) : null}
    </section>
  );
}

function DirectoryRow({
  directory,
  depth,
  expanded,
  forceOpen,
  selectedId,
  item,
  canStart,
  disabledReason,
  onToggle,
  onRun,
  onOpenSource,
}: {
  readonly directory: SpecDirectory;
  readonly depth: number;
  readonly expanded: ReadonlySet<string>;
  readonly forceOpen: boolean;
  readonly selectedId: string | null;
  readonly item: ReturnType<typeof useTreeNavigation>['item'];
  readonly canStart: boolean;
  readonly disabledReason: string;
  readonly onToggle: (key: string) => void;
  readonly onRun: (targets: readonly string[]) => void;
  readonly onOpenSource: (test: ExecutionCase) => void;
}) {
  const open = forceOpen || expanded.has(directory.key);
  const targets = exactTargets(directory.cases);
  const roving = item(directory.key);
  return (
    <section
      ref={roving.ref}
      tabIndex={roving.tabIndex}
      className="tw-spec-directory"
      data-depth={depth}
      style={depthStyle(depth)}
      role="treeitem"
      aria-selected={selectedId === directory.key}
      aria-expanded={open}
      aria-label={`Directory ${directory.name}`}
      onFocus={(event) => {
        if (event.currentTarget === event.target) roving.onFocus();
      }}
      onKeyDown={(event) => {
        if (event.currentTarget !== event.target) return;
        if ((event.key === 'Enter' || event.key === ' ') && !forceOpen) {
          event.preventDefault();
          onToggle(directory.key);
        } else if (event.key.toLowerCase() === 'r' && canStart) {
          event.preventDefault();
          onRun(targets);
        }
      }}
    >
      <header className="tw-spec-group-row">
        <Tooltip
          label={`${open ? 'Collapse' : 'Expand'} directory ${directory.name}`}
          disabledReason="Clear search to restore directory expansion controls."
        >
          <button
            tabIndex={-1}
            type="button"
            className="tw-spec-toggle"
            aria-label={`${open ? 'Collapse' : 'Expand'} directory ${directory.name}`}
            disabled={forceOpen}
            onClick={() => onToggle(directory.key)}
          >
            {open ? (
              <ChevronDown aria-hidden="true" size={14} />
            ) : (
              <ChevronRight aria-hidden="true" size={14} />
            )}
            {open ? (
              <FolderOpen aria-hidden="true" size={16} />
            ) : (
              <Folder aria-hidden="true" size={16} />
            )}
            <span>
              <strong>{directory.name}</strong>
              <small>{directory.path}</small>
            </span>
          </button>
        </Tooltip>
        <SpecCounters cases={directory.cases} compact />
        <Tooltip
          label={`Run directory ${directory.name} (${targets.length} cases)`}
          disabledReason={disabledReason}
        >
          <button
            tabIndex={-1}
            type="button"
            className="tw-spec-group-run"
            disabled={!canStart || targets.length === 0}
            onClick={() => onRun(targets)}
          >
            <Play aria-hidden="true" size={12} /> Run
          </button>
        </Tooltip>
      </header>
      {open ? (
        <div className="tw-spec-children" role="group">
          {directory.directories.map((child) => (
            <DirectoryRow
              key={child.key}
              directory={child}
              depth={depth + 1}
              expanded={expanded}
              forceOpen={forceOpen}
              selectedId={selectedId}
              item={item}
              canStart={canStart}
              disabledReason={disabledReason}
              onToggle={onToggle}
              onRun={onRun}
              onOpenSource={onOpenSource}
            />
          ))}
          {directory.files.map((file) => (
            <FileRow
              key={file.key}
              file={file}
              depth={depth + 1}
              expanded={expanded}
              forceOpen={forceOpen}
              selectedId={selectedId}
              item={item}
              canStart={canStart}
              disabledReason={disabledReason}
              onToggle={onToggle}
              onRun={onRun}
              onOpenSource={onOpenSource}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}

function FileRow({
  file,
  depth,
  expanded,
  forceOpen,
  selectedId,
  item,
  canStart,
  disabledReason,
  onToggle,
  onRun,
  onOpenSource,
}: {
  readonly file: SpecFile;
  readonly depth: number;
  readonly expanded: ReadonlySet<string>;
  readonly forceOpen: boolean;
  readonly selectedId: string | null;
  readonly item: ReturnType<typeof useTreeNavigation>['item'];
  readonly canStart: boolean;
  readonly disabledReason: string;
  readonly onToggle: (key: string) => void;
  readonly onRun: (targets: readonly string[]) => void;
  readonly onOpenSource: (test: ExecutionCase) => void;
}) {
  const open = forceOpen || expanded.has(file.key);
  const targets = exactTargets(file.cases);
  const roving = item(file.key);
  return (
    <section
      ref={roving.ref}
      tabIndex={roving.tabIndex}
      className="tw-spec-file"
      data-depth={depth}
      style={depthStyle(depth)}
      role="treeitem"
      aria-selected={selectedId === file.key}
      aria-expanded={open}
      aria-label={`File ${file.name}`}
      onFocus={(event) => {
        if (event.currentTarget === event.target) roving.onFocus();
      }}
      onKeyDown={(event) => {
        if (event.currentTarget !== event.target) return;
        if ((event.key === 'Enter' || event.key === ' ') && !forceOpen) {
          event.preventDefault();
          onToggle(file.key);
        } else if (event.key.toLowerCase() === 'r' && canStart) {
          event.preventDefault();
          onRun(targets);
        }
      }}
    >
      <header className="tw-spec-group-row">
        <Tooltip
          label={`${open ? 'Collapse' : 'Expand'} file ${file.name}`}
          disabledReason="Clear search to restore file expansion controls."
        >
          <button
            tabIndex={-1}
            type="button"
            className="tw-spec-toggle"
            aria-label={`${open ? 'Collapse' : 'Expand'} file ${file.name}`}
            disabled={forceOpen}
            onClick={() => onToggle(file.key)}
          >
            {open ? (
              <ChevronDown aria-hidden="true" size={14} />
            ) : (
              <ChevronRight aria-hidden="true" size={14} />
            )}
            <FileCode2 aria-hidden="true" size={16} />
            <span>
              <strong>{file.name}</strong>
              <small>{file.path}</small>
            </span>
          </button>
        </Tooltip>
        <SpecCounters cases={file.cases} compact />
        <Tooltip
          label={`Run file ${file.name} (${targets.length} cases)`}
          disabledReason={disabledReason}
        >
          <button
            tabIndex={-1}
            type="button"
            className="tw-spec-group-run"
            disabled={!canStart || targets.length === 0}
            onClick={() => onRun(targets)}
          >
            <Play aria-hidden="true" size={12} /> Run
          </button>
        </Tooltip>
      </header>
      {open ? (
        <div className="tw-spec-cases" role="group">
          {file.visibleCases.map((test) => (
            <CaseRow
              key={test.caseKey}
              test={test}
              depth={depth + 1}
              selectedId={selectedId}
              item={item}
              canStart={canStart && runnableCase(test)}
              disabledReason={disabledReason}
              onRun={onRun}
              onOpenSource={onOpenSource}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}

function CaseRow({
  test,
  depth,
  selectedId,
  item,
  canStart,
  disabledReason,
  onRun,
  onOpenSource,
}: {
  readonly test: ExecutionCase;
  readonly depth: number;
  readonly selectedId: string | null;
  readonly item: ReturnType<typeof useTreeNavigation>['item'];
  readonly canStart: boolean;
  readonly disabledReason: string;
  readonly onRun: (targets: readonly string[]) => void;
  readonly onOpenSource: (test: ExecutionCase) => void;
}) {
  const id = `case:${test.caseKey}`;
  const roving = item(id);
  return (
    <article
      ref={roving.ref}
      tabIndex={roving.tabIndex}
      className="tw-spec-case"
      data-kind={test.kind}
      data-depth={depth}
      style={depthStyle(depth)}
      role="treeitem"
      aria-selected={selectedId === id}
      onFocus={(event) => {
        if (event.currentTarget === event.target) roving.onFocus();
      }}
      onKeyDown={(event) => {
        if (event.currentTarget !== event.target) return;
        if ((event.key === 'Enter' || event.key === ' ') && canStart) {
          event.preventDefault();
          onRun([test.caseKey]);
        } else if (event.key.toLowerCase() === 'o') {
          event.preventDefault();
          onOpenSource(test);
        }
      }}
    >
      <StatusBadge status={test.status} compact />
      <div>
        <strong>{test.title}</strong>
        <span>
          <FileCode2 aria-hidden="true" size={12} />
          {test.provider ?? 'provider unavailable'} ·{' '}
          {test.kind === 'test'
            ? 'test'
            : test.kind === 'gherkin-scenario'
              ? 'scenario'
              : 'outline example'}{' '}
          · {test.ancestors.map((ancestor) => ancestor.title).join(' · ') || 'Test'}
          {test.source.line === undefined ? '' : ` · line ${test.source.line}`}
        </span>
        {test.tags.length === 0 ? null : (
          <small>
            <Tags aria-hidden="true" size={11} /> {test.tags.join(' ')}
          </small>
        )}
      </div>
      <span className="tw-spec-case-actions">
        <Tooltip label={`Open ${test.title} source`}>
          <button
            tabIndex={-1}
            type="button"
            className="tw-spec-source"
            aria-label={`Open ${test.title} source`}
            onClick={() => onOpenSource(test)}
          >
            <ExternalLink aria-hidden="true" size={13} />
          </button>
        </Tooltip>
        <Tooltip
          label={`Run ${test.title}`}
          disabledReason={
            test.provider === null
              ? 'This provider did not opt into Termwright execution.'
              : disabledReason
          }
        >
          <button
            tabIndex={-1}
            type="button"
            disabled={!canStart}
            onClick={() => onRun([test.caseKey])}
          >
            <Play aria-hidden="true" size={13} /> Run
          </button>
        </Tooltip>
      </span>
    </article>
  );
}

function depthStyle(depth: number): CSSProperties {
  return {
    '--tw-spec-indent': `${depth * 18}px`,
    '--tw-spec-indent-compact': `${depth * 14}px`,
  } as CSSProperties;
}

function SpecCounters({
  cases,
  compact = false,
}: {
  readonly cases: readonly ExecutionCase[];
  readonly compact?: boolean;
}) {
  const counts = countStatuses(cases);
  const facts = [
    ['passed', counts.passed],
    ['failed', counts.failed],
    ['running', counts.running],
    ['waiting', counts.waiting],
  ] as const;
  return (
    <span
      className="tw-spec-counters"
      aria-label={`${cases.length} total, ${facts.map(([label, value]) => `${value} ${label}`).join(', ')}`}
    >
      {!compact ? <span data-tone="total">{cases.length} total</span> : null}
      {facts
        .filter(([, value]) => !compact || value > 0)
        .map(([label, value]) => (
          <span key={label} data-tone={label}>
            {value} {compact ? label[0] : label}
          </span>
        ))}
    </span>
  );
}

function buildTree(cases: readonly ExecutionCase[], projectRoot: string): SpecDirectory {
  const mutable: MutableDirectory = directory('', 'root');
  for (const test of cases) {
    const relative = relativePath(test.source.file, projectRoot);
    const segments = relative.split('/').filter(Boolean);
    const fileName = segments.pop() ?? test.source.file;
    let current = mutable;
    current.cases.push(test);
    let path = '';
    for (const segment of segments) {
      path = path === '' ? segment : `${path}/${segment}`;
      let child = current.directories.get(segment);
      if (child === undefined) {
        child = directory(path, segment);
        current.directories.set(segment, child);
      }
      child.cases.push(test);
      current = child;
    }
    const existing = current.files.get(test.source.file) ?? {
      key: `file:${test.source.file}`,
      path: relative,
      name: fileName,
      cases: [],
    };
    existing.cases.push(test);
    current.files.set(test.source.file, existing);
  }
  return freezeDirectory(mutable);
}

interface MutableDirectory {
  readonly key: string;
  readonly path: string;
  readonly name: string;
  readonly cases: ExecutionCase[];
  readonly files: Map<string, MutableFile>;
  readonly directories: Map<string, MutableDirectory>;
}
interface MutableFile {
  readonly key: string;
  readonly path: string;
  readonly name: string;
  readonly cases: ExecutionCase[];
}
function directory(path: string, name: string): MutableDirectory {
  return { key: `dir:${path}`, path, name, cases: [], files: new Map(), directories: new Map() };
}
function freezeDirectory(value: MutableDirectory): SpecDirectory {
  return {
    key: value.key,
    path: value.path,
    name: value.name,
    cases: value.cases,
    directories: [...value.directories.values()].sort(byName).map(freezeDirectory),
    files: [...value.files.values()]
      .sort(byName)
      .map((file) => ({ ...file, visibleCases: file.cases })),
  };
}

function filterTree(root: SpecDirectory, query: string): SpecDirectory {
  const needle = query.trim().toLowerCase();
  if (needle === '') return root;
  return filterDirectory(root, needle, true) ?? { ...root, directories: [], files: [] };
}
function filterDirectory(node: SpecDirectory, needle: string, root = false): SpecDirectory | null {
  if (!root && node.path.toLowerCase().includes(needle)) return node;
  const directories = node.directories
    .map((child) => filterDirectory(child, needle))
    .filter((child): child is SpecDirectory => child !== null);
  const files = node.files
    .map((file) => {
      const visibleCases = file.path.toLowerCase().includes(needle)
        ? file.cases
        : file.cases.filter((test) => matches(test, needle));
      return visibleCases.length === 0 ? null : { ...file, visibleCases };
    })
    .filter((file): file is SpecFile => file !== null);
  return directories.length === 0 && files.length === 0 ? null : { ...node, directories, files };
}

function defaultExpansion(root: SpecDirectory): readonly string[] {
  return root.directories.map((node) => node.key);
}
function specTreeRows(
  root: SpecDirectory,
  expanded: ReadonlySet<string>,
  forceOpen: boolean,
): readonly { readonly id: string; readonly parentId?: string; readonly hasChildren: boolean }[] {
  const rows: { id: string; parentId?: string; hasChildren: boolean }[] = [];
  const appendDirectory = (node: SpecDirectory, parentId?: string) => {
    rows.push({
      id: node.key,
      ...(parentId === undefined ? {} : { parentId }),
      hasChildren: node.directories.length + node.files.length > 0,
    });
    if (!forceOpen && !expanded.has(node.key)) return;
    node.directories.forEach((child) => appendDirectory(child, node.key));
    node.files.forEach((file) => appendFile(file, node.key));
  };
  const appendFile = (file: SpecFile, parentId?: string) => {
    rows.push({
      id: file.key,
      ...(parentId === undefined ? {} : { parentId }),
      hasChildren: file.visibleCases.length > 0,
    });
    if (!forceOpen && !expanded.has(file.key)) return;
    file.visibleCases.forEach((test) =>
      rows.push({ id: `case:${test.caseKey}`, parentId: file.key, hasChildren: false }),
    );
  };
  root.directories.forEach((node) => appendDirectory(node));
  root.files.forEach((file) => appendFile(file));
  return rows;
}
function specParentKeys(root: SpecDirectory): readonly string[] {
  const keys: string[] = [];
  const append = (node: SpecDirectory) => {
    keys.push(node.key);
    node.directories.forEach(append);
    node.files.forEach((file) => keys.push(file.key));
  };
  root.directories.forEach(append);
  root.files.forEach((file) => keys.push(file.key));
  return keys;
}
function exactTargets(cases: readonly ExecutionCase[]): readonly string[] {
  return [...new Set(cases.filter(runnableCase).map((test) => test.caseKey))];
}
function runnableCase(test: ExecutionCase): boolean {
  return test.provider !== null;
}
function relativePath(file: string, projectRoot: string): string {
  const normalizedFile = file.replaceAll('\\', '/');
  const normalizedRoot = projectRoot.replaceAll('\\', '/').replace(/\/+$/u, '');
  if (normalizedRoot === '' && projectRoot.replaceAll('\\', '/').startsWith('/'))
    return normalizedFile.replace(/^\/+/, '');
  if (normalizedRoot !== '' && normalizedFile.startsWith(`${normalizedRoot}/`))
    return normalizedFile.slice(normalizedRoot.length + 1);
  const segments = normalizedFile.split('/').filter(Boolean);
  return segments.slice(-3).join('/');
}
function matches(test: ExecutionCase, needle: string): boolean {
  return [
    test.title,
    test.source.file,
    ...test.tags,
    ...test.ancestors.map((ancestor) => ancestor.title),
  ].some((value) => value.toLowerCase().includes(needle));
}
function byName<T extends { readonly name: string }>(left: T, right: T): number {
  return left.name.localeCompare(right.name);
}
function runDisabledReason(canRun: boolean, connected: boolean, runBusy: boolean): string {
  if (runBusy) return 'A run is already active; use Stop in Runner.';
  if (!connected) return 'Runner connection is unavailable.';
  if (!canRun) return 'This viewer cannot start tests.';
  return 'No owned tests are available in this scope.';
}
function countStatuses(cases: readonly ExecutionCase[]): {
  readonly passed: number;
  readonly failed: number;
  readonly running: number;
  readonly waiting: number;
} {
  const values = { passed: 0, failed: 0, running: 0, waiting: 0 };
  for (const test of cases) {
    const status: ExecutionStatus = test.status;
    if (status === 'passed') values.passed += 1;
    else if (status === 'failed' || status === 'cancelled') values.failed += 1;
    else if (status === 'running') values.running += 1;
    else values.waiting += 1;
  }
  return values;
}
