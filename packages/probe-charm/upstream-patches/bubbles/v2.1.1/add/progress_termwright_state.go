package progress

// Accessors added by termwright.
//
// `Percent()` returns the target, not what is on screen: during an animation
// the bar shows `percentShown` while the getter reports `targetPercent`. A
// test asserting on the visible progress needs the first, and there is no
// public way to reach it.

// TermwrightShownPercent reports the fraction currently drawn, 0..1.
func (m Model) TermwrightShownPercent() float64 { return m.percentShown }

// TermwrightTargetPercent reports the fraction being animated towards.
func (m Model) TermwrightTargetPercent() float64 { return m.targetPercent }
