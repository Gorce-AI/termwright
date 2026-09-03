// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

// Deployed to https://gorce-ai.github.io/termwright/ by .github/workflows/docs.yml.
// TODO(custom domain): when docs.termwright.dev is set up, drop `base`, set
// `site` to the domain and add a `public/CNAME` file holding it.
export default defineConfig({
  site: 'https://gorce-ai.github.io',
  base: '/termwright',
  trailingSlash: 'always',
  integrations: [
    starlight({
      title: 'Termwright',
      logo: {
        src: './src/assets/termwright-mark.svg',
        alt: '',
        replacesTitle: false,
      },
      favicon: '/favicon.svg',
      description: 'Test interactive command-line applications through a real pseudoterminal.',
      social: [
        {
          icon: 'github',
          label: 'GitHub',
          href: 'https://github.com/gorce-ai/termwright',
        },
      ],
      editLink: {
        baseUrl: 'https://github.com/gorce-ai/termwright/edit/main/website/',
      },
      lastUpdated: true,
      customCss: ['./src/styles/custom.css'],
      sidebar: [
        {
          label: 'Start',
          items: [
            { label: 'Install and first test', slug: 'getting-started' },
            { label: 'Write a terminal test', slug: 'writing-tests' },
            { label: 'Run tests', slug: 'running-tests' },
          ],
        },
        {
          label: 'Test workflow',
          items: [
            { label: 'Choose a locator', slug: 'guides/locators' },
            { label: 'Send input', slug: 'guides/actions' },
            { label: 'Assert and wait', slug: 'guides/assertions' },
            { label: 'Prepare test files', slug: 'guides/test-files' },
            { label: 'Run shell commands', slug: 'guides/shell-commands' },
            { label: 'Use snapshots', slug: 'guides/snapshots' },
          ],
        },
        {
          label: 'Debug failures',
          collapsed: true,
          items: [
            { label: 'Debug a failed test', slug: 'tools/debugging' },
            { label: 'Use the Runner', slug: 'tools/runner-ui' },
            { label: 'Open traces and reports', slug: 'tools/traces-reports' },
            { label: 'Inspect application logs', slug: 'guides/app-logs' },
            { label: 'Runner accessibility', slug: 'tools/accessibility' },
          ],
        },
        {
          label: 'Framework integrations',
          collapsed: true,
          items: [
            { label: 'Overview', slug: 'adapters' },
            { label: 'Ink', slug: 'adapters/ink' },
            { label: 'Test Ink components', slug: 'guides/component-testing' },
            { label: 'OpenTUI', slug: 'adapters/opentui' },
            { label: 'Textual (Python)', slug: 'adapters/textual' },
            { label: 'tview (Go)', slug: 'adapters/tview' },
            { label: 'Ratatui (Rust)', slug: 'adapters/ratatui' },
            { label: 'Bubble Tea', slug: 'adapters/bubbletea' },
            { label: 'Compatibility table', slug: 'reference/compatibility' },
          ],
        },
        {
          label: 'CI and configuration',
          collapsed: true,
          items: [
            { label: 'Run tests in CI', slug: 'guides/ci' },
            { label: 'Configure Termwright', slug: 'reference/configuration' },
            { label: 'Protect secrets', slug: 'reference/security' },
            { label: 'Supported platforms', slug: 'reference/limitations' },
          ],
        },
        {
          label: 'Advanced workflows',
          collapsed: true,
          items: [
            { label: 'Record a test', slug: 'tools/recorder' },
            { label: 'Browse examples', slug: 'guides/examples' },
            { label: 'Migrate an existing suite', slug: 'guides/migrating' },
            { label: 'Extend test fixtures', slug: 'guides/fixtures' },
            { label: 'Write Gherkin scenarios', slug: 'guides/gherkin' },
            { label: 'Use terminal profiles', slug: 'guides/terminal-profiles' },
            { label: 'Connect AI agents', slug: 'guides/mcp' },
          ],
        },
        {
          label: 'Concepts',
          collapsed: true,
          items: [
            { label: 'Coming from web testing', slug: 'concepts/web-testing' },
            { label: 'How semantic locators work', slug: 'concepts/semantics' },
            { label: 'How waiting works', slug: 'concepts/waiting-retries' },
            { label: 'Why use a real terminal?', slug: 'guides/why-not-tmux' },
          ],
        },
        {
          label: 'Reference',
          collapsed: true,
          items: [
            { label: 'Test API overview', slug: 'reference/test-api' },
            { label: 'TypeScript API', slug: 'api' },
            { label: 'CLI and exit codes', slug: 'reference/cli' },
            { label: 'Gherkin reference', slug: 'reference/gherkin' },
            { label: 'MCP tools', slug: 'reference/mcp' },
            { label: 'Errors', slug: 'reference/errors' },
            { label: 'Geometry and visibility', slug: 'reference/geometry-visibility' },
            { label: 'Packages and exports', slug: 'reference/packages' },
            { label: 'Terminal compatibility', slug: 'reference/terminal-compatibility' },
          ],
        },
      ],
    }),
  ],
});
