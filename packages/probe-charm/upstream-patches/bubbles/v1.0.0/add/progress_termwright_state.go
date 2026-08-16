package progress

// Accessors added by termwright.
//
// Identical to the v2 set: these five field names survived the major bump
// unchanged. Verified by compiling, not by assuming — the fields that did
// change (filepicker min/max → minIdx/maxIdx) are ones no accessor here
// touches, and that is luck rather than design.
//
// `Percent()` returns the target, not what is on screen: during an animation
// the bar shows `percentShown` while the getter reports `targetPercent`. A
// test asserting on the visible progress needs the first, and there is no
// public way to reach it.

// TermwrightShownPercent reports the fraction currently drawn, 0..1.
func (m Model) TermwrightShownPercent() float64 { return m.percentShown }

// TermwrightTargetPercent reports the fraction being animated towards.
func (m Model) TermwrightTargetPercent() float64 { return m.targetPercent }
