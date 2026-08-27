# Upstream audit — Textual

> **Historical Phase 0 evidence.** The pinned-source measurements below are
> retained as design evidence. Any current support or setup guidance is
> superseded by the website Textual adapter guide and compatibility reference.

Phase 0 of the zero-config instrumentation campaign. This is a survey of what
Textual already knows about its own UI and how a probe could reach it without
the application changing a line. It proposes no design; where a fact rules an
approach in or out, it says so and stops.

**Version audited:** Textual 8.2.8 on CPython 3.12.11. This is the measured
baseline, not an executable allowlist: current support is decided by runtime
capability checks plus behavioral conformance.

Paths below are relative to the installed package root, i.e.
`site-packages/textual/`. Line numbers are from 8.2.8 and will move.

---

## 1. The DOM, and what identifies a node

Textual has a real retained DOM, which is the single most important fact for
instrumentation: unlike an immediate-mode framework, the widget objects exist
between frames and can be inspected at rest.

- `DOMNode` (`dom.py:135`) is the base of everything in the tree. It holds its
  children in a `NodeList` at `dom.py:206` (`self._nodes`), exposed read-only
  through `children` (`dom.py:406`).
- `Widget` extends `DOMNode`; the whole visible tree hangs off a `Screen`.
- Querying is first-class: `DOMNode.query(...)` walks the subtree with CSS
  selectors, and `App.screen.query("*")` enumerates the active screen.

**Identity.** There is no framework-assigned stable node id.

- `DOMNode.id` (`dom.py:810`) is the _author's_ id, optional, and settable once
  (`dom.py:815`). Most widgets in most applications have none.
- The only always-available identity is the Python object itself. Object
  identity is stable for the lifetime of the widget, which spans frames, so a
  probe can key on `id(widget)` or a `WeakKeyDictionary` and get identity that
  survives redraws — the property Ratatui cannot offer at all (see
  `ratatui.md` §4).
- Identity does **not** survive a widget being recreated: `recompose` builds
  new objects, and the new ones are unrelated to the old. Any id scheme built
  on object identity therefore reports "new node" after a recompose, which is
  correct but must not be mistaken for "changed node".

## 2. Roles from the class, via the MRO

The class hierarchy is the role source, and it works for subclasses without
any registration, which is the behaviour the campaign asks for
(`SaveButton(Button)` must be a `button`).

- Every widget is an ordinary Python class, so `type(widget).__mro__` yields
  the full ancestry, ending at `Widget` → `DOMNode` → `MessagePump` → `object`.
- Walking the MRO and taking the first class name present in a role map gives
  `SaveButton(Button) → button` with no author involvement. The existing
  hand-written adapter already does exactly this
  (`clients/python/src/termwright/textual_adapter.py`, `role_for`), and the
  mechanism carries over unchanged to a probe.
- The map must be keyed on class _name_, not on imported class objects, if the
  probe is to avoid importing `textual.widgets` eagerly — importing the widget
  package to compare classes would pull in the whole widget library at probe
  load time.

## 3. Geometry: three regions, and the one that is true

Textual computes geometry in the compositor and exposes it per widget. There
are several regions and they mean different things; picking the wrong one is
the easiest way to publish a plausible-looking lie.

- `Widget.region` (`widget.py:2285`) — the widget's rectangle in **screen**
  coordinates. Implemented as `self.screen.find_widget(self).region`, so it is
  a compositor lookup, not a cached field.
- `Widget.virtual_region` (`widget.py:2321`) — position relative to the
  container, which may be scrolled out of view.
- `Widget.window_region` (`widget.py:2337`) — `region` shifted by the scroll
  offset.
- `Widget.content_region` (`widget.py:2235`) and
  `scrollable_content_region` (`widget.py:2245`) — the inner areas after
  padding/border and after scrollbars respectively.

All of these come from one record. `Screen.find_widget` (`screen.py:740`)
delegates to `Compositor.find_widget` (`_compositor.py:970`) and returns a
`MapGeometry` (`map_geometry.py`), a `NamedTuple` carrying:

| field            | meaning                                           |
| ---------------- | ------------------------------------------------- |
| `region`         | screen-absolute rectangle                         |
| `order`          | paint order, as a tuple of per-ancestor triples   |
| `clip`           | the clipping rectangle imposed by containers      |
| `virtual_size`   | scrollable extent, when the widget is a container |
| `container_size` | area minus scrollbars                             |
| `virtual_region` | position within the container                     |
| `dock_gutter`    | space reserved by docked widgets                  |

and one derived property that matters more than any of the above:

- `MapGeometry.visible_region` (`map_geometry.py`) — `clip ∩ region`, "the
  Widget region after clipping".

**Finding.** `region` is _not_ what the user can see. A widget scrolled halfway
out of a container has a `region` that extends past the container, and only
`visible_region` reflects what is on screen. The current hand-written adapter
publishes `region` and is therefore wrong for clipped widgets — it reports
bounds for cells the user cannot see. A probe should publish
`visible_region`, and can additionally distinguish "scrolled out of view"
(empty `visible_region`) from "not displayed" (`display = False`), which are
different states that today collapse into one.

`Compositor.visible_widgets` (`_compositor.py:496`) returns the whole mapping
of widget → `(region, clip)` filtered to what is actually on screen, which is
a cheaper source than one `find_widget` per node.

## 4. Focus, selection, value

- **Focus.** `App.focused` (`app.py:1291`) is the global answer, and
  `Widget.has_focus` (`widget.py:360`) is a reactive per widget. Per-widget is
  the safer read: `App.focused` requires touching the app object, and the
  existing adapter learned the hard way that reaching into the app from inside
  the render path can deadlock (see §5). `Widget.has_focus_within`
  (`widget.py:918`) reports focus in the subtree, which is what makes
  "deepest focused node" computable without a second pass.
- **Selection.** Two unrelated meanings share the word. Text selection is
  `Widget.text_selection` (`widget.py:689`), with the screen tracking a
  signal (`screen.py:321`). Item selection in collections is per widget:
  `ListView.index`, `DataTable.cursor_coordinate`, `OptionList.highlighted`.
  There is no common protocol; a probe must map them per class.
- **Value.** Also per class, and typically a `reactive`:
  `Input.value` (`widgets/_input.py:253`), `Switch.value`
  (`widgets/_switch.py:113`), `ToggleButton.value`
  (`widgets/_toggle_button.py:130`, the base of `Checkbox` and `RadioButton`),
  `TextArea.text`, `Select.value`. Because they are reactives, they are plain
  attribute reads at probe time — no method call, no side effect.

## 5. Where the tree and the geometry are both true

The campaign needs a moment when the DOM, the layout and the screen agree.
Candidates, in the order the frame reaches them:

1. **`App._display`** (`app.py:3821`) — renders the compositor's output and
   writes it to the driver.
2. **`App.post_display_hook`** (`app.py:3892`), called at `app.py:3890` from
   inside `_display`'s `finally`. It is documented as "Called immediately
   after a display is done. Used in tests." — an empty method that exists to
   be overridden.
3. `Screen._on_idle` (`screen.py:1172`) — decides whether a repaint or relayout
   is needed and resumes the update timer; runs _before_ layout is settled, so
   geometry read here may be stale.

**Phase 0 identified `post_display_hook` as the observation point**, for two
reasons the source makes explicit:

- it runs after `root.Draw(...)`-equivalent work, so the compositor map is
  fresh and `find_widget` answers with the geometry that was just painted;
- it exists as an override point, so a probe replacing it is using the seam the
  framework offers rather than monkey-patching a private method.

**The later commit-boundary implementation corrected the Phase 0 ordering
assumption.** Inside `_display` the
sequence is: write the frame to the driver (`app.py:3883`), `_end_update()` in
a `finally` (`app.py:3885`), `self._driver.flush()` (`app.py:3887`), and only
then `post_display_hook()` in the outer `finally` (`app.py:3890`). In Textual
8.2.8 the built-in driver's `flush()` does not prove physical output: bytes are
queued to its `WriterThread`. The production probe therefore preflights the
exact built-in driver/writer, wraps the concrete write, proves enqueue into the
same FIFO, and appends the marker to that FIFO. `_display` plus
`post_display_hook` delimit the attempt and fresh DOM observation; the hook
alone is not a causal output-commit guarantee. A render exception produces no
semantic commit.

**Deadlock hazard.** Reading `App.focused` from inside the hook is safe, but
calling anything that takes the app's lock (`App.Draw`, `QueueUpdate`) from
within the display path is not. The existing Go adapter hit the equivalent
deadlock in tview; in Textual the equivalent trap is calling back into the app
rather than reading widget state.

## 6. Injection: PYTHONPATH plus our own `sitecustomize.py`

The mechanism the campaign proposes is: the driver sets `PYTHONPATH` to an
ephemeral directory containing a `sitecustomize.py` we control, and CPython's
`site` module imports it during interpreter startup, before the application's
first line runs.

Everything below was **measured on this machine** (CPython 3.12.11, macOS),
not recalled.

| Invocation                                   | `sitecustomize` ran?                                    |
| -------------------------------------------- | ------------------------------------------------------- |
| `python script.py`                           | yes                                                     |
| `python -m package`                          | yes                                                     |
| `python -c "..."`                            | yes                                                     |
| console-script entry point (`venv/bin/tool`) | yes                                                     |
| `uv run --no-project python main.py`         | yes                                                     |
| `python -S script.py`                        | **no** — `-S` disables `site` entirely                  |
| `python -E script.py`                        | **no** — `-E` makes the interpreter ignore `PYTHONPATH` |

`poetry` was not installed here, so its behaviour is **unverified**. It runs
the interpreter from the project venv as a subprocess and passes the
environment through, so it is expected to behave as the venv row does; that
expectation should be confirmed before it is relied on.

Three further measurements matter more than the table:

**a. The script's own directory does not shadow us.** At the moment
`sitecustomize` is imported, `sys.path[0]` is our injected directory — the
script's directory has not been prepended yet. Measured by printing
`sys.path[0]` from inside `sitecustomize` while running a script from a
directory that also contained a `sitecustomize.py`: ours ran, the neighbour's
did not. Only an explicit `PYTHONPATH` entry ordered _before_ ours displaces
us.

**b. We shadow anything already installed.** `PYTHONPATH` precedes
`site-packages` and the stdlib directory, so our `sitecustomize` displaces one
the environment already has, and `site` imports exactly one. This is not
hypothetical: **Homebrew's CPython ships its own `sitecustomize.py`** which
reorders `sys.path` and validates `PYTHONPATH` against the interpreter version
(`/opt/homebrew/Cellar/python@3.12/.../lib/python3.12/sitecustomize.py`).
Silently disabling it on the most common macOS developer setup would change
`sys.path` semantics under instrumentation only — a class of bug that appears
to be caused by the tool and cannot be reproduced without it. A probe must
therefore locate and execute the displaced module itself.

**c. Chaining works, but "the displaced one" is ambiguous.** Re-importing the
next `sitecustomize.py` found on `sys.path` after removing our own directory
succeeded in a measurement, but the first match was the Homebrew stdlib one,
while a `site-packages/sitecustomize.py` also existed. There can be more than
one; the chain must decide deliberately which it runs, and record what it did.

**d. `usercustomize` is not a second chance.** In a virtualenv,
`site.ENABLE_USER_SITE` is `False` (measured: `False` in the venv, `True` for
`/usr/bin/python3`), so `usercustomize` is not imported at all. `sitecustomize`
is the only startup hook that fires inside a venv.

**Ephemerality and ownership.** Nothing above writes to the project. The
directory lives wherever the driver puts it and is named only in the launched
environment. The implemented bootstrap is atomically one-shot: the owning
interpreter captures its endpoint and token process-locally, then removes the
credentials, owner marker, and bootstrap path before application code runs.
Fork children are explicitly disowned as well. Descendants therefore cannot
reuse the parent's authenticated semantic session.

## 7. Version sensitivity

Ordered by how much of the design would move if it broke.

| Surface                                             | Stability                                           | Note                                                          |
| --------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------- |
| `DOMNode.children`, `query`                         | public, documented                                  | safe                                                          |
| `Widget.region`, `virtual_region`, `content_region` | public, documented                                  | safe                                                          |
| `App.focused`, `Widget.has_focus`                   | public                                              | safe                                                          |
| per-widget `value`/`text`/`index`                   | public per class                                    | the _set_ of classes changes between releases                 |
| `App.post_display_hook`                             | public but documented as "used in tests"            | the attachment point; an undocumented removal would be silent |
| `Screen.find_widget` → `MapGeometry`                | public method, `MapGeometry` is a public NamedTuple | field order could change; access by name                      |
| `Compositor.visible_widgets`                        | **private** (`_compositor.py`)                      | the cheap bulk read is off the supported path                 |
| `DOMNode._nodes`                                    | **private**                                         | `children` is the public equivalent; prefer it                |

The Python extra declares Textual 8.2.8 as an advisory minimum. Strong
instrumentation is not allowlisted by version: public tree APIs are validated
when observed, and the private display/writer seam is shape- and
behavior-checked on each committed frame. The daily candidate suite installs
the checksum-bound candidate and runs the full Python and conformance suites;
it records the outcome without generating a runtime allowlist or repinning the
package.

## 8. Summary of findings that change the design

1. Textual's retained DOM gives **frame-stable object identity**, so nodes can
   be tracked across renders. Recompose breaks it, correctly.
2. The MRO already delivers **automatic role inheritance** for subclasses; no
   registration is needed and none should be invented.
3. `region` is the wrong rectangle. **`visible_region` (`clip ∩ region`)** is
   what the user sees, and the current adapter is wrong here.
4. `post_display_hook` supplies fresh geometry, but causal commit additionally
   requires the observed `_display` attempt and built-in WriterThread FIFO wrappers;
   the hook alone does not prove terminal output.
5. `sitecustomize` injection covers every invocation style measured except the
   two that opt out by flag (`-S`, `-E`), and **must chain to the
   `sitecustomize` it displaces** — Homebrew's Python ships one that does real
   work.
6. `poetry run` requires a one-hop launcher marker because Poetry is itself a
   Python console process. The generated startup hook consumes that marker in
   Poetry and leaves the application interpreter to claim the bootstrap;
   deterministic fake-launcher coverage runs even where Poetry is absent.
