package list

// Accessors added by termwright.
//
// The status message is transient text the list shows and then clears. It has
// no getter, so from outside it is indistinguishable from any other row of the
// rendered output.

// TermwrightStatusMessage reports the transient status text, or "".
func (m Model) TermwrightStatusMessage() string { return m.statusMessage }
