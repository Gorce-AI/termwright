package filepicker

// Accessors added by termwright.
//
// Identical to the v2 set: these five field names survived the major bump
// unchanged. Verified by compiling, not by assuming — the fields that did
// change (filepicker min/max → minIdx/maxIdx) are ones no accessor here
// touches, and that is luck rather than design.
//
// Which entry is highlighted is the single most useful fact about a file
// picker and the only one it keeps entirely private. `HighlightedPath()` gives
// a path but not the position, so a test cannot say "the third entry" or check
// how many there are.

// TermwrightSelectedIndex reports the highlighted entry's position, or -1.
func (m Model) TermwrightSelectedIndex() int {
	if m.selected < 0 || m.selected >= len(m.files) {
		return -1
	}
	return m.selected
}

// TermwrightEntryCount reports how many entries the current directory has.
func (m Model) TermwrightEntryCount() int { return len(m.files) }

// TermwrightSelectedName reports the highlighted entry's name, or "".
func (m Model) TermwrightSelectedName() string {
	if index := m.TermwrightSelectedIndex(); index >= 0 {
		return m.files[index].Name()
	}
	return ""
}
