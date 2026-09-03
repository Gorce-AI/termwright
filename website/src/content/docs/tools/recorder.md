---
title: Record a test
description: Drive a terminal application in the Runner, review generated steps and assertions, then save the test explicitly.
---

The recorder starts a real terminal session and builds test source from the
interactions you choose to retain. Recording does not write a test file until
you review and save it.

## Start recording

From the command line:

```sh
npx termwright ui --record --out-file tests/permission.test.ts -- node app.js
```

Or open Specs, choose **New test**, and select **Record test**. Enter the command
and destination, then start the session.

[![Recorder launch dialog with command and output file fields.](/termwright/images/runner/recorder.png)](/termwright/images/runner/recorder.png)

## Build the test

While recording:

- type and press keys in the terminal;
- add a named step before a group of interactions;
- select a semantic element to add a locator-based action or assertion;
- capture a cell or semantic snapshot where a stable state matters.

The recorder shows generated source as the session changes. Semantic actions
are available only when the application publishes the required target and
capability.

[![An active recording with the real terminal and recorder controls visible.](/termwright/images/runner/recorder-active.png)](/termwright/images/runner/recorder-active.png)

## Stop and review

Choose **Stop recording** to enter review. Check:

1. the launch command and destination;
2. step names;
3. whether locators describe user intent;
4. generated assertions and snapshots;
5. imports and test title.

Choose **Save** to write the file. Choose **Discard** to close the recording
without writing it. Closing the review dialog with Escape also leaves the
destination untouched.

[![Recorder review dialog showing generated test source before it is saved.](/termwright/images/runner/recorder-review.png)](/termwright/images/runner/recorder-review.png)

## Use the generated test as a starting point

Run the saved file immediately:

```sh
npx termwright test -- tests/permission.test.ts
```

Then simplify it. Remove incidental interactions, add assertions for the
outcome, and replace positional selectors with role/name locators where
possible. A recorded sequence is useful scaffolding; the maintained test
should describe the behavior it protects.

## Record from a dedicated command

`termwright codegen` is an alias for the recorder-focused workflow:

```sh
npx termwright codegen --out-file tests/permission.test.ts -- node app.js
```
