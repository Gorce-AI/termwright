---
'@termwright/ui': minor
'termwright': minor
---

Add shared ARIA tree navigation to the Semantic Inspector and Specs catalogue:
one roving tab stop, Up/Down/Home/End traversal, Left/Right branch navigation,
and focus and selection retention across live re-renders.

Runner URLs now retain the active view, run, execution, trace, and replay
position across refresh and Back/Forward. Authentication is removed from the
address before React starts and remains tab-scoped rather than becoming part of
a copied deep link or browser history state.
