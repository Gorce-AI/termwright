package spinner

// Accessors added by termwright.
//
// Identical to the v2 set: these five field names survived the major bump
// unchanged. Verified by compiling, not by assuming — the fields that did
// change (filepicker min/max → minIdx/maxIdx) are ones no accessor here
// touches, and that is luck rather than design. The frame index is the whole state a spinner
// has, and it has no getter — so from outside the package a spinner is a
// glyph, and a test cannot tell "still spinning" from "stuck".
//
// This file exists in termwright's private copy only. Upstream never sees it.

// TermwrightFrame reports which frame is being drawn.
func (m Model) TermwrightFrame() int { return m.frame }

// TermwrightFrameCount reports how many frames the animation has.
func (m Model) TermwrightFrameCount() int { return len(m.Spinner.Frames) }
