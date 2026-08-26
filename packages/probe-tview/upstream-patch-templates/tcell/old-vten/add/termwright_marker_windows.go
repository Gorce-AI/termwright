//go:build windows

package tcell

import (
	"errors"
	"io"
	"syscall"
	"unicode/utf16"
	"unsafe"
)

var (
	termwrightKernel32       = syscall.NewLazyDLL("kernel32.dll")
	termwrightGetConsoleMode = termwrightKernel32.NewProc("GetConsoleMode")
	termwrightSetConsoleMode = termwrightKernel32.NewProc("SetConsoleMode")
)

const termwrightMarkerOutputMode = uint32(0x0001 | 0x0004) // processed output + VT processing

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
	var originalMode uint32
	if ok, _, err := termwrightGetConsoleMode.Call(uintptr(s.out), uintptr(unsafe.Pointer(&originalMode))); ok == 0 {
		return err
	}
	if ok, _, err := termwrightSetConsoleMode.Call(uintptr(s.out), uintptr(originalMode|termwrightMarkerOutputMode)); ok == 0 {
		return err
	}
	var written uint32
	writeErr := syscall.WriteConsole(s.out, &encoded[0], uint32(len(encoded)), &written, nil)
	restored, _, restoreErr := termwrightSetConsoleMode.Call(uintptr(s.out), uintptr(originalMode))
	if writeErr != nil {
		return writeErr
	}
	if restored == 0 {
		return restoreErr
	}
	if written != uint32(len(encoded)) {
		return io.ErrShortWrite
	}
	return nil
}
