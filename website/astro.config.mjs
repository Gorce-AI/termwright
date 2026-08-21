// @ts-check
import {defineConfig} from 'astro/config';
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
			title: 'termwright',
			logo: {
				src: './src/assets/termwright-logo.svg',
				alt: '',
				replacesTitle: true,
			},
			favicon: '/favicon.svg',
			description:
				'End-to-end testing for terminal applications, with real input, retrying assertions, traces, and framework semantics.',
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
						{label: 'Getting started', slug: 'getting-started'},
						{label: 'Writing tests', slug: 'writing-tests'},
						{label: 'Running tests', slug: 'running-tests'},
						{label: 'Migration', slug: 'guides/migrating'},
						{label: 'Examples', slug: 'guides/examples'},
					],
				},
				{
					label: 'Write tests',
					items: [
						{label: 'Locators', slug: 'guides/locators'},
						{label: 'Actions and input', slug: 'guides/actions'},
						{label: 'Assertions', slug: 'guides/assertions'},
						{label: 'Snapshots', slug: 'guides/snapshots'},
						{label: 'Test files and isolation', slug: 'guides/test-files'},
						{label: 'Extend test fixtures', slug: 'guides/fixtures'},
						{label: 'Gherkin scenarios', slug: 'guides/gherkin'},
						{label: 'Ink component tests', slug: 'guides/component-testing'},
					],
				},
				{
					label: 'Runner and debugging',
					items: [
						{label: 'Runner UI', slug: 'tools/runner-ui'},
						{label: 'Debug a failed test', slug: 'tools/debugging'},
						{label: 'Traces and reports', slug: 'tools/traces-reports'},
						{label: 'Record a test', slug: 'tools/recorder'},
						{label: 'Application logs', slug: 'guides/app-logs'},
						{label: 'AI agents', slug: 'guides/mcp'},
						{label: 'Runner accessibility', slug: 'tools/accessibility'},
					],
				},
				{
					label: 'Framework integrations',
					collapsed: true,
					items: [
						{label: 'Overview', slug: 'adapters'},
						{label: 'Ink', slug: 'adapters/ink'},
						{label: 'OpenTUI', slug: 'adapters/opentui'},
						{label: 'Textual (Python)', slug: 'adapters/textual'},
						{label: 'tview (Go)', slug: 'adapters/tview'},
						{label: 'Ratatui (Rust)', slug: 'adapters/ratatui'},
						{label: 'Bubble Tea', slug: 'adapters/bubbletea'},
					],
				},
				{
					label: 'Configuration and CI',
					collapsed: true,
					items: [
						{label: 'Configuration', slug: 'reference/configuration'},
						{label: 'CI and retries', slug: 'guides/ci'},
					],
				},
				{
					label: 'Concepts',
					collapsed: true,
					items: [
						{label: 'Terminal semantics', slug: 'concepts/semantics'},
						{label: 'Waiting and retries', slug: 'concepts/waiting-retries'},
						{label: 'Terminal profiles', slug: 'guides/terminal-profiles'},
						{label: 'Why a real terminal?', slug: 'guides/why-not-tmux'},
					],
				},
				{
					label: 'Reference',
					collapsed: true,
					items: [
						{label: 'Test API overview', slug: 'reference/test-api'},
						{label: 'CLI and exit codes', slug: 'reference/cli'},
						{label: 'Gherkin reference', slug: 'reference/gherkin'},
						{label: 'MCP tools', slug: 'reference/mcp'},
						{label: 'Errors', slug: 'reference/errors'},
						{label: 'Framework compatibility', slug: 'reference/compatibility'},
						{label: 'Geometry and visibility', slug: 'reference/geometry-visibility'},
						{label: 'Packages and exports', slug: 'reference/packages'},
						{label: 'Platforms and limitations', slug: 'reference/limitations'},
						{label: 'Releases and versioning', slug: 'reference/releasing'},
					],
				},
				{
					label: 'Internals and contributing',
					collapsed: true,
					items: [
						{label: 'Write an integration', slug: 'adapters/writing-an-adapter'},
						{label: 'Semantic protocol', slug: 'reference/protocol'},
						{label: 'AccessKit export', slug: 'reference/accessibility'},
						{label: 'Architecture decisions', slug: 'reference/decisions'},
					],
				},
			],
		}),
	],
});
