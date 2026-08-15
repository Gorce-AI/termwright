---
title: Assertions and snapshots
description: Matchers that poll, the semantic YAML snapshot format, cell snapshots, and how updating them works.
---

Every matcher is asynchronous — `await expect(...)` — and the locator ones poll
until the `expect` timeout class runs out. That retrying is not a convenience;
it is what makes an assertion safe immediately after physical input.

## The matchers

| Matcher | Subject |
|---|---|
| `toBeVisible()` | locator |
| `toBeFocused()` | locator |
| `toHaveState({disabled: true})` | locator; asserts only the keys you list |
| `toHaveText('Save' \| /Sav/)` | locator (exact, whitespace-normalized) or terminal (substring of the grid) |
| `toMatchSemanticSnapshot(expected?)` | terminal or a `SemanticSnapshot` |
| `toMatchCellSnapshot(expected?)` | terminal or a `ScreenSnapshot` |

```ts
await expect(app.getByRole('button', {name: 'Approve'})).toBeVisible();
await expect(app.getByRole('textbox', {name: 'Message'})).toBeFocused();
await expect(app.getByRole('button', {name: 'Submit'})).toHaveState({disabled: true});
await expect(app).toHaveText('running: ls -la');
```

## An assertion is a wait

`waitForText()` returns when the *grid* shows the text, but the semantic tree
describing that frame only becomes observable once its render-commit marker has
been paired — including the very first tree after the handshake, where
`semanticTree()` is still `null` while `capabilities().semanticTree` is already
`true`.

Every tree-reading matcher polls through that gap, which is why the idiomatic
way to sequence physical input is to put an assertion between the steps:

```ts
await app.press('Tab');
await expect(app.getByRole('textbox', {name: 'Message'})).toBeFocused();
await app.type('hello');
```

Reading the tree yourself is the case that needs an explicit wait:

```ts
await app.waitForText('Saved');
await app.waitForStable();          // now the tree describes that frame
const state = await locator.semanticState();
```

## Semantic YAML snapshots

The headline feature: the accessibility tree of a terminal app in a form a
reviewer can read and a diff can show.

```yaml
- dialog "Permission" [modal]:
    - text "Allow bash to run?"
    - button "Approve" [focused]
    - button /Rej.*/
```

```ts
await expect(app).toMatchSemanticSnapshot(`
  - dialog "Permission" [modal]:
      - button "Approve" [focused]
      - button /^Rej/
`);
```

The rules, normative in [`CONTRACTS.md`](https://github.com/gorce-ai/termwright/blob/main/CONTRACTS.md)
§YAML snapshots:

- **Partial by default.** Omitted children are don't-care and unlisted siblings
  are allowed. Listed children must keep their relative order.
- **Names** are compared after whitespace normalization, may be written as
  `/regex/`, and may be omitted entirely to match any name.
- **`[flags]`** assert only what they list. `!focused` asserts the opposite,
  `checked=mixed` and `level=2` compare a value. Volatile states
  (`scrollOffset`, `positionInSet`, …) are left out of written snapshots unless
  you ask for `{states: 'all'}`.
- `'* "Save"'` matches any role — and it has to be quoted, because a bare `*`
  opens a YAML alias.
- A name containing `#` is written quoted, so the file stays valid YAML.

## Cell snapshots, and why both

`toMatchCellSnapshot()` captures what was actually painted:

```
┌─ 60×3 ─────────────────────────────────────────────────────┐
│Permission required                                         │
│   Approve    [Reject]                                      │
│last: ACTIVATED reject                                      │
└────────────────────────────────────────────────────────────┘
```

Semantic and cell snapshots are separate oracles on purpose: **a semantic
snapshot can pass on a blank screen**, because the adapter publishes a tree
nobody painted. An important end-to-end test asserts both.

## Where snapshots live, and how they update

Called without an argument, both matchers store the value in
`__snapshots__/<test file>.tw-semantic.yaml` (or `.tw-cells.yaml`), one literal
block per assertion, keyed by test name.

Vitest's `--update` has two states; the contract asks for three, so the mode is
resolved like this:

| Source | Mode |
|---|---|
| `TERMWRIGHT_UPDATE_SNAPSHOTS=all` | rewrite every snapshot, even matching ones |
| `TERMWRIGHT_UPDATE_SNAPSHOTS=changed`, or `vitest -u` | write missing, overwrite mismatching |
| `TERMWRIGHT_UPDATE_SNAPSHOTS=missing`, or a plain run | write missing; a mismatch fails |
| `TERMWRIGHT_UPDATE_SNAPSHOTS=none`, or `--update=none` | never write; a missing snapshot fails |

`config.updateSnapshots` overrides all of it.

:::caution[Updating a semantic snapshot rewrites your patterns]
Updating replaces the stored pattern with the full serialized tree — any regex
or partial matching you hand-wrote is gone. Review the diff before committing.
:::

A snapshot being written for the first time waits for a tree rather than storing
the absence of one, so a first run cannot silently record `null` semantics.

## Reading a failure

```
expect(getByRole('button', { name: 'Approve' })).toBeVisible()

Expected: visible
Received: hidden
Timeout:  5000ms

suggestion: narrow the locator with within(), a name option, or select one with first()/nth()
candidates:
  - button "Reject" ref=n4@7
screen:
  Permission required
     Approve    [Reject]
```

The same failure, with the reporter configured, also lands in the HTML report
with a visual diff, a semantic diff and the recording — see
[Traces and reports](../traces/).
