---
title: "@termwright/test"
editUrl: false
---

**@termwright/test**

***

# @termwright/test

`@termwright/test` — the authoring surface for the Termwright Native Host:
Vitest-powered DSL, fixtures, retry-able matchers, semantic YAML snapshots
and cell snapshots. It is not a direct-Vitest compatibility preset.

Importing this module registers the matchers with `expect`, so a test file
only ever imports `test` and `expect` from here.

## Example

```ts
import {fileURLToPath} from 'node:url';
import {test, expect} from 'termwright/test';

test('asks before running a command', async ({ terminal }) => {
  const appFile = fileURLToPath(new URL('../app.js', import.meta.url));
  const app = await terminal.launch({ command: [process.execPath, appFile] });
  await app.waitForText('Permission required');

  await expect(app).toMatchSemanticSnapshot(`
    - dialog "Permission" [modal]:
        - button "Approve" [focused]
        - button /^Rej/
  `);

  await app.getByRole('button', { name: 'Approve' }).activate();
  await expect(app.getByTestId('status')).toHaveText('ACTIVATED approve');
});
```

## Interfaces

- [AttachFixtureOptions](interfaces/attachfixtureoptions/)
- [CapturedLog](interfaces/capturedlog/)
- [CellSnapshotMatcherOptions](interfaces/cellsnapshotmatcheroptions/)
- [CellSnapshotOptions](interfaces/cellsnapshotoptions/)
- [ColorPalette](interfaces/colorpalette/)
- [LaunchFixtureOptions](interfaces/launchfixtureoptions/)
- [LaunchOverrides](interfaces/launchoverrides/)
- [LogCollection](interfaces/logcollection/)
- [LogQuery](interfaces/logquery/)
- [LogSource](interfaces/logsource/)
- [OpenShellFixtureOptions](interfaces/openshellfixtureoptions/)
- [PollOptions](interfaces/polloptions/)
- [PtyUnavailableReason](interfaces/ptyunavailablereason/)
- [ResolvedTermwrightConfig](interfaces/resolvedtermwrightconfig/)
- [ScreenLocator](interfaces/screenlocator/)
- [SeedOptions](interfaces/seedoptions/)
- [SeedTemplate](interfaces/seedtemplate/)
- [SemanticLocator](interfaces/semanticlocator/)
- [SemanticSnapshotMatcherOptions](interfaces/semanticsnapshotmatcheroptions/)
- [SerializeOptions](interfaces/serializeoptions/)
- [StepOptions](interfaces/stepoptions/)
- [TerminalFactory](interfaces/terminalfactory/)
- [TerminalHarness](interfaces/terminalharness/)
- [TermwrightConfig](interfaces/termwrightconfig/)
- [TermwrightFixtures](interfaces/termwrightfixtures/)
- [TermwrightMatchers](interfaces/termwrightmatchers/)
- [TermwrightOptions](interfaces/termwrightoptions/)
- [TermwrightRetryOptions](interfaces/termwrightretryoptions/)
- [TermwrightScopeFixture](interfaces/termwrightscopefixture/)
- [TermwrightTestResources](interfaces/termwrighttestresources/)
- [TermwrightVitestProject](interfaces/termwrightvitestproject/)
- [TestTimeoutClasses](interfaces/testtimeoutclasses/)
- [TextMatcherOptions](interfaces/textmatcheroptions/)

## Type Aliases

- [AnyLocator](type-aliases/anylocator/)
- [ResourceAwareTestApi](type-aliases/resourceawaretestapi/)
- [SeedFile](type-aliases/seedfile/)
- [SeedFiles](type-aliases/seedfiles/)
- [StateSelection](type-aliases/stateselection/)
- [StepRunner](type-aliases/steprunner/)
- [TermwrightExpect](type-aliases/termwrightexpect/)
- [TermwrightTestAPI](type-aliases/termwrighttestapi/)
- [TraceMode](type-aliases/tracemode/)
- [UpdateSnapshotsMode](type-aliases/updatesnapshotsmode/)

## Variables

- [ANSI\_COLOR\_NAMES](variables/ansi_color_names/)
- [it](variables/it/)
- [step](variables/step/)
- [test](variables/test/)
- [XTERM\_PALETTE](variables/xterm_palette/)

## Functions

- [collectLogs](functions/collectlogs/)
- [configureTermwright](functions/configuretermwright/)
- [defineTermwrightConfig](functions/definetermwrightconfig/)
- [getTermwrightConfig](functions/gettermwrightconfig/)
- [ptyAvailable](functions/ptyavailable/)
- [ptyUnavailableReason](functions/ptyunavailablereason/)
- [registerTermwrightMatchers](functions/registertermwrightmatchers/)
- [seedDirectory](functions/seeddirectory/)
- [serializeScreen](functions/serializescreen/)
- [serializeSemanticSnapshot](functions/serializesemanticsnapshot/)
- [termwrightProjects](functions/termwrightprojects/)
- [termwrightRetry](functions/termwrightretry/)
