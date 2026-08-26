//go:build windows

package tea

import (
	"io"
	"syscall"
	"unicode/utf16"
	"unsafe"
)

var (
	termwrightKernel32       = syscall.NewLazyDLL("kernel32.dll")
	termwrightGetConsoleMode = termwrightKernel32.NewProc("GetConsoleMode")
	termwrightSetConsoleMode = termwrightKernel32.NewProc("SetConsoleMode")
	termwrightGetFileType    = termwrightKernel32.NewProc("GetFileType")
)

const termwrightMarkerOutputMode = uint32(0x0001 | 0x0004)
const termwrightFileTypeDisk = uintptr(0x0001)
const termwrightFileTypePipe = uintptr(0x0003)

// The renderer lock and termwrightProbeState.publishMu are both held here.
// Using the renderer's exact handle keeps FRAME -> MARKER on one console
// writer while temporarily restoring the VT mode a user application may have
// disabled. Non-console writers remain ordinary byte streams.
func termwrightWriteMarker(writer io.Writer, marker string) (int, error) {
	file, ok := writer.(interface{ Fd() uintptr })
	if !ok {
		return io.WriteString(writer, marker)
	}
	handle := syscall.Handle(file.Fd())
	var originalMode uint32
	if result, _, modeErr := termwrightGetConsoleMode.Call(uintptr(handle), uintptr(unsafe.Pointer(&originalMode))); result == 0 {
		fileType, _, _ := termwrightGetFileType.Call(uintptr(handle))
		if fileType == termwrightFileTypeDisk || fileType == termwrightFileTypePipe {
			return io.WriteString(writer, marker)
		}
		return 0, modeErr
	}
	if result, _, err := termwrightSetConsoleMode.Call(uintptr(handle), uintptr(originalMode|termwrightMarkerOutputMode)); result == 0 {
		return 0, err
	}
	encoded := utf16.Encode([]rune(marker))
	var written uint32
	writeErr := syscall.WriteConsole(handle, &encoded[0], uint32(len(encoded)), &written, nil)
	restored, _, restoreErr := termwrightSetConsoleMode.Call(uintptr(handle), uintptr(originalMode))
	if writeErr != nil {
		return 0, writeErr
	}
	if restored == 0 {
		return 0, restoreErr
	}
	if written != uint32(len(encoded)) {
		return 0, io.ErrShortWrite
	}
	return len(marker), nil
}
