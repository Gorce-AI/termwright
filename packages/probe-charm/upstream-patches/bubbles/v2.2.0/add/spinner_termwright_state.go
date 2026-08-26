package spinner

// Accessors added by termwright. The frame index is the whole state a spinner
// has, and it has no getter — so from outside the package a spinner is a
// glyph, and a test cannot tell "still spinning" from "stuck".
//
// This file exists in termwright's private copy only. Upstream never sees it.

// TermwrightFrame reports which frame is being drawn.
func (m Model) TermwrightFrame() int { return m.frame }

// TermwrightFrameCount reports how many frames the animation has.
func (m Model) TermwrightFrameCount() int { return len(m.Spinner.Frames) }
