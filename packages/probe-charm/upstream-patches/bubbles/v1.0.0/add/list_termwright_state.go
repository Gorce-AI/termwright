package list

// Accessors added by termwright.
//
// Identical to the v2 set: these five field names survived the major bump
// unchanged. Verified by compiling, not by assuming — the fields that did
// change (filepicker min/max → minIdx/maxIdx) are ones no accessor here
// touches, and that is luck rather than design.
//
// The status message is transient text the list shows and then clears. It has
// no getter, so from outside it is indistinguishable from any other row of the
// rendered output.

// TermwrightStatusMessage reports the transient status text, or "".
func (m Model) TermwrightStatusMessage() string { return m.statusMessage }
