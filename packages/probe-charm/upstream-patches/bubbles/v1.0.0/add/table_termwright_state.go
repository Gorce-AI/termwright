package table

// Accessors added by termwright.
//
// Identical to the v2 set: these five field names survived the major bump
// unchanged. Verified by compiling, not by assuming — the fields that did
// change (filepicker min/max → minIdx/maxIdx) are ones no accessor here
// touches, and that is luck rather than design.
//
// `start` and `end` are the rows actually rendered. Without them a test cannot
// tell "row 40 is not in the table" from "row 40 is scrolled out of view",
// which are different failures with different fixes.

// TermwrightWindow reports the half-open range of rows currently rendered.
func (m Model) TermwrightWindow() (int, int) { return m.start, m.end }

// TermwrightRowCount reports how many rows the table holds in total.
func (m Model) TermwrightRowCount() int { return len(m.rows) }
