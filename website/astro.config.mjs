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
			description:
				'Playwright for the terminal: a real PTY, a standards-grade VT emulator, and an application-published semantic tree.',
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
				{label: 'Getting started', slug: 'getting-started'},
				{
					label: 'Guides',
					items: [
						{label: 'Locators', slug: 'guides/locators'},
						{label: 'Assertions and snapshots', slug: 'guides/assertions'},
						{label: 'Component testing', slug: 'guides/component-testing'},
						{label: 'Traces, recordings, reports', slug: 'guides/traces'},
						{label: 'Application logs', slug: 'guides/app-logs'},
						{label: 'Terminal profiles', slug: 'guides/terminal-profiles'},
						{label: 'Debugging a failing test', slug: 'guides/debugging'},
						{label: 'Runner UI', slug: 'guides/runner-ui'},
						{label: 'MCP for agents', slug: 'guides/mcp'},
						{label: 'Why not tmux?', slug: 'guides/why-not-tmux'},
						{label: 'Migrating', slug: 'guides/migrating'},
					],
				},
				{
					label: 'Adapters',
					items: [
						{label: 'Overview', slug: 'adapters'},
						{label: 'Ink', slug: 'adapters/ink'},
						{label: 'OpenTUI', slug: 'adapters/opentui'},
						{label: 'Textual (Python)', slug: 'adapters/textual'},
						{label: 'tview (Go)', slug: 'adapters/tview'},
						{label: 'Bubble Tea', slug: 'adapters/bubbletea'},
						{label: 'Writing an adapter', slug: 'adapters/writing-an-adapter'},
					],
				},
				{
					label: 'Reference',
					items: [
						{label: 'Packages', slug: 'reference/packages'},
						{label: 'Protocol v1', slug: 'reference/protocol'},
						{label: 'Configuration', slug: 'reference/configuration'},
						{label: 'Accessibility', slug: 'reference/accessibility'},
						{label: 'CLI and exit codes', slug: 'reference/cli'},
						{label: 'Releasing', slug: 'reference/releasing'},
						{label: 'Limitations and FAQ', slug: 'reference/limitations'},
						{label: 'Decisions (ADRs)', slug: 'reference/decisions'},
					],
				},
			],
		}),
	],
});
