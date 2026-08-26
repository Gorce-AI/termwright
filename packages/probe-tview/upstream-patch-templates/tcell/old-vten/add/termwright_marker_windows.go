//go:build windows

package tcell

import (
	"errors"
	"io"
	"syscall"
	"unicode/utf16"
)

// TermwrightWriteMarker exposes the exact console handle hidden behind the
// screenImpl interface returned by NewConsoleScreen.
func (b *baseScreen) TermwrightWriteMarker(marker string) error {
	s, ok := b.screenImpl.(*cScreen)
	if !ok {
		return errors.New("tcell: screen is not the Windows console implementation")
	}
	s.Lock()
	defer s.Unlock()
	if s.fini {
		return errors.New("tcell: screen is finalized")
	}
	if !s.vten {
		return errors.New("tcell: Windows console has no VT output capability")
	}
	encoded := utf16.Encode([]rune(marker))
	if len(encoded) == 0 {
		return nil
	}
	var written uint32
	if err := syscall.WriteConsole(s.out, &encoded[0], uint32(len(encoded)), &written, nil); err != nil {
		return err
	}
	if written != uint32(len(encoded)) {
		return io.ErrShortWrite
	}
	return nil
}
