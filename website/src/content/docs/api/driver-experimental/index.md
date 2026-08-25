---
title: "@termwright/driver/experimental"
editUrl: false
---

**@termwright/driver/experimental**

***

# @termwright/driver/experimental

Low-level integration seams for framework adapters and Termwright's own
infrastructure. These exports may change before the stable driver API.

Application tests should import from `@termwright/driver` instead.

## Classes

- [ProcessLifecycleError](classes/processlifecycleerror/)

## Interfaces

- [ConPtySessionHandle](interfaces/conptysessionhandle/)
- [GenericQuery](interfaces/genericquery/)
- [KeyEncodingModes](interfaces/keyencodingmodes/)
- [LaunchTerminalWithBackendOptions](interfaces/launchterminalwithbackendoptions/)
- [MouseEvent](interfaces/mouseevent/)
- [PtyBackend](interfaces/ptybackend/)
- [PtyBackendChoice](interfaces/ptybackendchoice/)
- [PtyProcess](interfaces/ptyprocess/)
- [PtySpawnOptions](interfaces/ptyspawnoptions/)
- [RefQuery](interfaces/refquery/)
- [SemanticQuery](interfaces/semanticquery/)
- [SemanticStep](interfaces/semanticstep/)
- [StylePredicates](interfaces/stylepredicates/)
- [TerminalLaunchResourceLease](interfaces/terminallaunchresourcelease/)

## Type Aliases

- [ConPtySpawn](type-aliases/conptyspawn/)
- [LocatorQuery](type-aliases/locatorquery/)
- [MouseButton](type-aliases/mousebutton/)
- [ParsedRef](type-aliases/parsedref/)
- [ProcessLifecycleErrorCode](type-aliases/processlifecycleerrorcode/)
- [PtySignal](type-aliases/ptysignal/)
- [PtyUnsubscribe](type-aliases/ptyunsubscribe/)
- [TerminalLaunchResourceProvider](type-aliases/terminallaunchresourceprovider/)
- [TextMatcher](type-aliases/textmatcher/)

## Variables

- [CONPTY\_BACKEND\_NAME](variables/conpty_backend_name/)

## Functions

- [createConPtyBackend](functions/createconptybackend/)
- [createNodePtyBackend](functions/createnodeptybackend/)
- [encodeKeys](functions/encodekeys/)
- [encodeMouse](functions/encodemouse/)
- [encodePaste](functions/encodepaste/)
- [encodeText](functions/encodetext/)
- [inheritedSpawnEnv](functions/inheritedspawnenv/)
- [launchTerminalWithBackend](functions/launchterminalwithbackend/)
- [normalizeMouseModifiers](functions/normalizemousemodifiers/)
- [parseRef](functions/parseref/)
- [parseSelector](functions/parseselector/)
- [resetPtyBackendChoice](functions/resetptybackendchoice/)
- [resolveDefaultPtyBackend](functions/resolvedefaultptybackend/)
- [semanticNodeId](functions/semanticnodeid/)
- [textMatcher](functions/textmatcher/)
