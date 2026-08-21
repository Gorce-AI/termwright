# Termwright documentation guide

This file is the source of truth for writing and maintaining Termwright
documentation. It applies to the documentation site, repository-level guides,
package READMEs, examples, screenshots, and public API documentation.

Read this guide before making a substantial documentation change. Product code,
public types, tests, and executable behavior take precedence over existing prose.

## Non-negotiables

- Write for the developer using Termwright.
- Show the recommended path before alternatives.
- Put working examples before implementation details.
- Document observable public behavior before mechanisms.
- Keep one canonical explanation for each concept.
- Show the actual product for visual workflows.
- Validate important examples against current code and tests.
- Build the site and check links before merging.
- Treat Playwright and Cypress as familiar mental models, not migration sources
  for terminal tests.

## Audience

The primary reader is a developer who wants to test a terminal or TUI
application. Assume that reader can work in TypeScript and a shell. Do not assume
they know Termwright packages, protocols, adapters, or internal architecture.

Secondary readers are:

- developers integrating a TUI framework with Termwright;
- adapter authors;
- advanced users diagnosing unusual behavior;
- Termwright contributors;
- coding agents using the docs as product context.

Keep secondary material available, but do not put it in the path to a first
passing test.

## Documentation philosophy

Write documentation in this order:

1. Show what the developer should do.
2. Explain when to use that approach.
3. Describe the observable behavior they can rely on.
4. Explain the design reason only when it changes correct usage.
5. Put implementation details in concepts, reference, adapter-authoring, or
   contributor documentation.

Use progressive disclosure. A normal learning path is:

`install -> first test -> launch -> locate -> interact -> assert -> run -> debug`

Semantics, snapshots, synchronization, adapters, traces, the wire protocol, and
internals follow when the reader needs them.

Prefer a working example followed by a short explanation and a focused caveat.
Do not begin a task guide with a history of the feature or an implementation
model.

Document the recommended path first. Label alternatives accurately as
specialized, low-level, compatibility-oriented, unsupported, or deprecated when
those distinctions exist. Do not present every available API as equally suitable.

Describe observable contracts before mechanisms. For example, document that an
assertion retries if that is public behavior. Do not introduce protocol revisions
or internal synchronization markers to explain the basic assertion.

## Sources of truth

Existing documentation is historical evidence, not a product specification.
Verify claims in this order:

1. current exported public API and TypeScript types;
2. current implementation;
3. automated tests;
4. executable CLI behavior and `--help` output;
5. configuration schemas and defaults;
6. package manifests and exports;
7. examples and fixtures;
8. current Runner UI behavior;
9. reports, traces, snapshots, adapters, and integrations;
10. existing documentation.

For normative contracts, also follow the owner files listed in
[`CONTRIBUTING.md`](../CONTRIBUTING.md#contracts-come-first).

When sources disagree, investigate the intended current behavior. Do not preserve
an old claim because it is already published. Do not invent a cleaner product
story. If the behavior is ambiguous, document what is verified and record the
product issue separately.

For user-facing commands and workflows, run the command a user runs. A function
that exists but is not reachable through the documented entry point is not a
working feature.

## Page types

Each page should have one primary responsibility.

### Tutorial

A tutorial teaches through one complete, successful sequence. It should:

- start from stated prerequisites;
- minimize choices and branching;
- use a known-good, runnable example;
- produce a visible result quickly;
- explain only what is necessary for the next step;
- end with a small set of relevant next pages.

Getting Started and the first-test walkthrough are tutorials.

### How-to guide

A how-to guide solves one developer task. It should:

- open with the normal recommended approach;
- put commands and code before extended explanation;
- assume the reader completed Getting Started;
- include alternatives only when they help complete the task;
- link to concepts and reference instead of duplicating them.

Locating an element, sending keyboard input, debugging a timeout, using Runner
UI, and configuring CI are how-to topics.

### Concept

A concept page explains behavior and trade-offs. It may contain diagrams and
selected implementation details when those details improve understanding.
Terminal semantics, synchronization, isolation, and semantic versus visual
assertions are concept topics.

Do not make a concept page a prerequisite for the first useful test unless the
concept is required to use the API correctly.

### Reference

Reference describes exact public behavior. It should be neutral, searchable, and
complete. Include exact names, types, defaults, allowed values, return values,
errors, and short examples. Do not add product positioning or narrative sections.

## Information architecture

Organize the main documentation around developer questions, not npm packages or
repository directories. The primary navigation should provide clear paths for:

- understanding what Termwright tests;
- installing Termwright and writing a first test;
- writing tests with locators, actions, assertions, and snapshots;
- using Runner UI and debugging failures;
- configuring projects and CI;
- selecting and installing framework integration;
- understanding core concepts;
- looking up API, CLI, configuration, compatibility, and limitations;
- contributing and understanding internals.

Keep package mapping, protocol revisions, architecture decisions, and contributor
material in reference or internals sections. A developer looking for a button
locator should not need to understand which package implements it.

The homepage may use limited product voice. It should explain the product quickly,
show a small representative test, state meaningful capabilities, and link to
Getting Started. Put comparisons and longer motivation on a separate page when
they are useful.

Give each concept one canonical explanation. Other pages should state only the
minimum context and link to it. Do not maintain parallel explanations of retrying,
semantics, adapters, timeouts, trace structure, or configuration precedence.

## Page structure

Open each page by stating its purpose and the recommended approach. A reader
should understand the page from its first paragraph.

For task pages, prefer this sequence:

1. runnable code or command;
2. expected result;
3. short explanation;
4. common variation or decision guidance;
5. failure mode or limitation when relevant;
6. links to deeper material.

Use a `Recommended approach` or `When to use this` section when the reader must
choose between real alternatives. Use a compact decision table when it makes the
choice clearer. Do not use tables only to compress prose.

Keep caveats near the problem they affect. Put uncommon cases in notes,
troubleshooting, advanced sections, or linked reference pages. Do not interrupt
every happy-path example with rare limitations.

Do not make every page self-contained. It is acceptable for an advanced guide to
assume Getting Started. Link to the canonical prerequisite instead of repeating
it.

## Headings

Headings are navigation and retrieval metadata. They must work in the sidebar,
table of contents, search, links, issue references, and coding-agent context.

Use searchable task and domain language:

- Install Termwright
- Run one test file
- Locate elements by role
- Handle multiple matches
- Type and press keys
- Update snapshots
- Debug an assertion timeout
- Open Runner UI
- Inspect a failed run

Avoid article-style headings, slogans, jokes, and headings whose meaning becomes
clear only after reading the section.

## Tone and language

Write like an experienced developer explaining a tool to another experienced
developer. Use direct, precise, calm, and practical language. Be opinionated when
Termwright has a preferred path and neutral in reference material.

Avoid:

- generic claims such as "powerful", "seamless", "robust", or "cutting-edge";
- a slogan, punchline, or philosophical defense after every technical fact;
- narrator phrases such as "this is where it gets interesting", "the point is",
  "the important thing here is", or "there is a reason";
- anthropomorphizing the runtime as honest, clever, principled, or reluctant;
- repeatedly justifying an API choice that the reader only needs to use;
- dense sentences that introduce several internal concepts at once;
- vague pronouns where an API, process, or UI region can be named;
- prose written for search engines or language models instead of developers.

State behavior directly. Prefer:

> `click()` throws `UnsupportedActionError` when mouse input is unavailable.

over a paragraph about why Termwright refuses to guess.

Some personality is appropriate on the homepage or a comparison page. Task
guides and reference pages should optimize for successful use and retrieval.

## Examples

Examples are the primary teaching mechanism.

- Show the preferred public API first.
- Use current exports, current package names, and current defaults.
- Keep examples small enough to understand and complete enough to run.
- Focus each example on one main idea.
- Reuse a small set of representative scenarios across pages so readers can
  transfer knowledge between them.
- Include the expected terminal state, output, error, diff, report, or UI state
  when it helps connect code to behavior.
- Do not configure a default explicitly unless the page teaches configuration.
- Do not invent plausible APIs or omit setup that materially affects the result.

Prefer checked examples from `examples/`, tested fixtures, or package READMEs.
When a Markdown snippet cannot be imported, run the complete version it is based
on and link to that source. An API rename must not leave believable but broken
snippets throughout the site.

Before merging example changes:

1. identify the public API or CLI behavior being taught;
2. verify it against exports, types, tests, and `--help` as applicable;
3. run the example or its canonical fixture;
4. build the documentation site;
5. record any intentionally unsupported behavior explicitly.

Do not create a custom documentation framework solely to validate prose. Prefer
existing TypeScript, fixture, browser, and package test infrastructure.

## Runner UI and screenshots

Runner UI documentation is visual documentation. Show the actual current UI next
to each major workflow. At minimum, cover current versions of the catalogue,
active run, terminal and command evidence, replay controls, failure inspection,
semantic inspector, run history, and recorder when those features exist.

Use a full-interface screenshot once for orientation. Use focused crops for later
tasks when the relevant control would otherwise be hard to read. Follow each
screenshot with the action the reader should take and the observable result.
Screenshots support the explanation; they do not replace searchable text.

Screenshot requirements:

- capture the real current product, not a mockup;
- use deterministic fixtures and state;
- use consistent theme and viewport where practical;
- crop unrelated desktop UI;
- remove tokens, usernames, private paths, secrets, and accidental local data;
- keep text readable at the rendered documentation width;
- use meaningful filenames and descriptive alt text;
- do not reuse a screenshot from an older UI because it looks better;
- use annotations only when they materially improve orientation;
- use animation only when motion is essential to the workflow.

Store Runner UI documentation assets under
`website/public/images/runner/`. Use lowercase, hyphenated names that identify the
workflow, for example `active-run.png` or `inspect-failure.png`.

### Regenerate Runner UI screenshots

The documentation capture command builds the current React app, starts the
Runner against deterministic fixtures, navigates through the documented states,
captures a 1440x900 viewport, and validates every PNG:

```sh
pnpm docs:screenshots
```

The fixture states and capture steps live in
`packages/ui/src/app/docs-screenshots.e2e.ts`; orchestration and objective PNG
checks live in `packages/ui/scripts/capture-docs-screenshots.mjs`. Generated
assets are written directly to `website/public/images/runner/`. Review the
rendered images after generation because automated checks cannot detect a poor
crop, unclear hierarchy, or stale visual explanation.

Update a screenshot when the layout, labels, documented workflow, or visible
result changes enough that the existing image no longer teaches the current
product. A one-pixel CSS change does not require screenshot churn.

## Runner UI documentation pattern

For each visual workflow:

1. state the goal;
2. show the command that opens the UI if needed;
3. show the current screenshot near the instruction;
4. name the relevant region or control;
5. describe the action and result;
6. link to deeper trace, semantics, recording, or debugging material.

Do not describe every panel in one long prose section. Do not use an oversized
screenshot as a substitute for focused workflow documentation.

## Public behavior and internal details

Ask of every technical statement:

> Is this stable behavior a user can rely on, or only the current implementation?

Put public behavior in user documentation. Put implementation details in
concepts, architecture, protocol, adapter-authoring, or contributor pages only
when one of these is true:

- adapter authors need the detail;
- contributors need it;
- it is intentionally stable;
- advanced users need it for diagnosis;
- it explains a meaningful observable limitation.

Beginner pages should not require knowledge of transport framing, protocol
revisions, internal state machines, snapshot encoding, private structures, or
adapter handshakes. Link to deeper pages when that information helps an advanced
reader.

## Framework integrations

Integration documentation should first answer:

1. Does this application need an adapter?
2. What capability does the adapter add?
3. Which adapter matches the framework?
4. How is it installed and connected?
5. How can the developer verify it works?

Keep adapter implementation and certification in the adapter-authoring guide.
Each framework page must list which locators, actions, geometry, visibility, and
pointer-related capabilities are supported, unsupported, or unknown. Do not
infer support from similar frameworks.

## Debugging and errors

Organize debugging around symptoms developers see:

1. visible symptom or stable error code/class;
2. what it means;
3. common causes;
4. next inspection step;
5. fix;
6. related guide or reference page.

Prefer concrete inspection steps in Runner UI, traces, reports, logs, or the CLI.
Do not explain the runtime architecture before helping the reader diagnose the
failure.

## Documentation verification

Run objective checks for every substantive documentation change:

```sh
pnpm --filter @termwright/website run check
pnpm --filter @termwright/website run build
pnpm --filter @termwright/website run check:links
```

Also run the examples, fixtures, package tests, CLI commands, or screenshot flow
that support changed claims. Check that referenced assets exist.

Inspect the rendered site, not only the Markdown diff. Review:

- desktop and narrow viewports;
- sidebar grouping and length;
- page outline and heading hierarchy;
- code block width and wrapping;
- tables and decision aids;
- screenshot readability, captions, and alt text;
- dark and light theme behavior;
- links between the happy path and advanced material;
- searchability of key tasks.

Do not automate subjective prose quality with a large custom linter. Automate
builds, links, missing assets, and examples where practical; enforce tone and
information architecture through review.

## User-journey review

Before a major documentation release, verify these journeys from the rendered
site without reading source code:

- A first-time developer can understand the product, install it, write a test,
  and see it pass.
- A developer writing a real test can find the recommended locator, action,
  assertion, and waiting behavior.
- A developer with a failed test can find the relevant evidence and next action.
- A Runner UI user can open it, recognize its regions, run a scope, replay a
  test, and inspect a failure.
- A framework user can decide whether an adapter is needed, install the correct
  one, and verify richer semantics.
- An advanced reader can find architecture and protocol material without it
  interrupting the beginner path.

If a journey requires private terminology or unrelated pages, revise the
information architecture.

## Editorial review

For each paragraph in a major developer-facing page, ask:

1. Does the reader need this information here?
2. Is it about their task or our implementation?
3. Could an example replace it?
4. Is the recommendation obvious?
5. Is it duplicated elsewhere?
6. Is it trying to sound clever?
7. Would a developer search for its heading?
8. Does it belong in reference or concepts?
9. Will it survive an internal refactor?
10. Is this the shortest clear version?

Delete, move, or rewrite material that fails this review. Documentation is
complete when the reader can perform the task and find deeper information, not
when every implementation detail appears on the page.

## Product-change checklist

For every user-visible product change, check:

- Did the public API, export, type, error, or default change?
- Did the preferred way to accomplish a task change?
- Did a CLI command, option, output, or exit code change?
- Did configuration or precedence change?
- Did framework compatibility or an unsupported capability change?
- Did Runner UI layout, labels, controls, or workflow change materially?
- Do current examples still compile and run?
- Are screenshots still accurate and reproducible?
- Did an experimental concept become stable, change meaning, or disappear?
- Does Getting Started still show the simplest recommended path?
- Does the change need a new page, or only an update to one canonical page?
- Are package READMEs and API documentation consistent with the site?
- Do the site build, links, assets, and relevant tests pass?

Do not append implementation notes to an unrelated guide. Put information in the
page type and location that matches the developer's question.

## Benchmark principles

The documentation system draws on patterns demonstrated by mature testing tools,
without copying their prose or mirroring their product structure:

- establish the first successful test with a small, complete example;
- state recommended locators and actions before enumerating alternatives;
- explain automatic waiting where it changes how tests should be written;
- separate task guides from exact API reference;
- document interactive tooling through real screenshots placed beside each
  workflow;
- connect a selected test step to its visual state, logs, source, and failure
  evidence;
- let developers run natural scopes such as all tests, a directory, a file, or a
  case;
- reveal advanced mechanics after the normal workflow is clear.

These are documentation-design principles. Termwright examples, terminology,
capabilities, and recommendations must always be derived from Termwright itself.
