export const certifiedProjectShards = Object.freeze([
  Object.freeze(['core']),
  Object.freeze(['go-integration']),
  Object.freeze(['gherkin', 'mcp', 'screenshot', 'test', 'trace', 'ui']),
  Object.freeze([
    'conformance',
    'ink',
    'probe-ink',
    'example-bubbletea-login',
    'example-getting-started',
    'example-ink-todo',
    'example-opentui-form',
    'example-ratatui-list',
    'example-textual-notes',
    'example-tview-menu',
  ]),
]);

export function projectSelectorArguments(projects) {
  return projects.map((project) => `--project=${project}`).join(' ');
}
