// Package protocol implements the termwright semantic side-channel wire
// protocol: length-prefixed JSON framing, the signed render-commit marker,
// message and snapshot validation, and a socket client.
//
// The normative implementation is the TypeScript package @termwright/protocol;
// this package is verified against the shared vectors in clients/test-vectors.
package protocol

import "fmt"

// Violation reports untrusted input that broke a wire invariant. Code mirrors
// the reference implementation's ProtocolViolation.code.
type Violation struct {
	Code   string
	Detail string
}

func (v *Violation) Error() string {
	return fmt.Sprintf("%s: %s", v.Code, v.Detail)
}

func violation(code, format string, args ...any) *Violation {
	return &Violation{Code: code, Detail: fmt.Sprintf(format, args...)}
}

// ViolationCode returns the code of a *Violation, or "" for any other error.
func ViolationCode(err error) string {
	if v, ok := err.(*Violation); ok {
		return v.Code
	}
	return ""
}
