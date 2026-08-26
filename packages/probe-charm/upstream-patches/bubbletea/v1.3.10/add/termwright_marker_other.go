//go:build !windows

package tea

import "io"

func termwrightWriteMarker(writer io.Writer, marker string) (int, error) {
	return io.WriteString(writer, marker)
}
