package protocol

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func envOf(pairs map[string]string) func(string) string {
	return func(name string) string { return pairs[name] }
}

func TestDebugPathOffWithoutAnyVariable(t *testing.T) {
	if path := DebugPath(envOf(nil)); path != "" {
		t.Fatalf("expected no path, got %q", path)
	}
}

// TERMWRIGHT_DEBUG=1 reaches the child process too, and the driver's own
// destination is stderr — which the adapter cannot use, because the app owns
// the terminal. A switch with no destination must leave the adapter silent.
func TestDriverSwitchesDoNotNameAFile(t *testing.T) {
	for _, value := range []string{"", "1", "true", "on", "api", "all", "0", "false", "off", "ALL"} {
		if path := DebugPath(envOf(map[string]string{EnvDebug: value})); path != "" {
			t.Fatalf("TERMWRIGHT_DEBUG=%q enabled the log with path %q", value, path)
		}
	}
}

func TestAPathInEitherVariableEnablesIt(t *testing.T) {
	if got := DebugPath(envOf(map[string]string{EnvDebug: "/tmp/a.log"})); got != "/tmp/a.log" {
		t.Fatalf("TERMWRIGHT_DEBUG path: got %q", got)
	}
	if got := DebugPath(envOf(map[string]string{EnvDebugFile: "/tmp/b.log"})); got != "/tmp/b.log" {
		t.Fatalf("TERMWRIGHT_DEBUG_FILE path: got %q", got)
	}
}

func TestTheFileVariableWins(t *testing.T) {
	got := DebugPath(envOf(map[string]string{EnvDebug: "/tmp/a.log", EnvDebugFile: "/tmp/b.log"}))
	if got != "/tmp/b.log" {
		t.Fatalf("got %q", got)
	}
}

func TestLinesCarryCategoryLabelAndElapsedTime(t *testing.T) {
	path := filepath.Join(t.TempDir(), "adapter.log")
	log := OpenDebugLog(path, "test-adapter")
	if log == nil {
		t.Fatal("expected a log")
	}
	log.Line("sem", "hello sent")
	log.SetLabel("abcdef0123456789")
	log.Line("io", "r1 snapshot nodes=3")
	log.Close()

	lines := strings.Split(strings.TrimRight(readFile(t, path), "\n"), "\n")
	if len(lines) != 3 {
		t.Fatalf("expected 3 lines, got %d: %q", len(lines), lines)
	}
	if !strings.HasPrefix(lines[0], "  tw:diag ") || !strings.Contains(lines[0], "adapter=test-adapter") {
		t.Fatalf("header line: %q", lines[0])
	}
	if want := fmt.Sprintf("  tw:sem  [p%d]", os.Getpid()); !strings.HasPrefix(lines[1], want) {
		t.Fatalf("expected prefix %q, got %q", want, lines[1])
	}
	if !strings.HasSuffix(lines[1], "s hello sent") {
		t.Fatalf("expected an elapsed time before the message: %q", lines[1])
	}
	// The session id replaces the pid once the handshake supplies one, and is
	// truncated to the driver's eight characters so both logs align.
	if !strings.HasPrefix(lines[2], "  tw:io   [abcdef01]") {
		t.Fatalf("label was not adopted: %q", lines[2])
	}
}

func TestItAppendsRatherThanTruncating(t *testing.T) {
	path := filepath.Join(t.TempDir(), "adapter.log")
	if err := os.WriteFile(path, []byte("earlier run\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	log := OpenDebugLog(path, "test")
	log.Line("diag", "later run")
	log.Close()

	text := readFile(t, path)
	if !strings.HasPrefix(text, "earlier run\n") || !strings.Contains(text, "later run") {
		t.Fatalf("expected an append, got %q", text)
	}
}

// A diagnostic that can break the application is worse than no diagnostic.
func TestAnUnwritablePathDisablesTheLog(t *testing.T) {
	path := filepath.Join(t.TempDir(), "no-such-directory", "adapter.log")
	if log := OpenDebugLog(path, "test"); log != nil {
		t.Fatal("expected nil for an unwritable path")
	}
}

func TestANilLogIsAWorkingNoOp(t *testing.T) {
	var log *DebugLog
	log.Line("diag", "goes nowhere")
	log.SetLabel("session")
	log.Close()
	if label := log.Label(); label != "" {
		t.Fatalf("got %q", label)
	}
}

func TestWritingAfterCloseIsSilent(t *testing.T) {
	log := OpenDebugLog(filepath.Join(t.TempDir(), "a.log"), "test")
	log.Close()
	log.Line("diag", "after close")
	log.Close()
}

func TestDescribeEndpointNamesTheTransport(t *testing.T) {
	if got := DescribeEndpoint("/tmp/tw.sock"); !strings.HasPrefix(got, "unix:") {
		t.Fatalf("got %q", got)
	}
	if got := DescribeEndpoint(`\\.\pipe\termwright-ab12`); !strings.HasPrefix(got, "pipe:") {
		t.Fatalf("got %q", got)
	}
}

// -- the reason for staying dormant ---------------------------------------

// The line that explains a run where the adapter never attached.
func TestDormancyReasonIsRecorded(t *testing.T) {
	path := filepath.Join(t.TempDir(), "adapter.log")
	log := OpenDebugLog(path, "test")
	if client := fromEnvValues("", "", "", Options{Debug: log}); client != nil {
		t.Fatal("expected no client")
	}
	log.Close()
	want := "dormant: TERMWRIGHT_ENDPOINT and TERMWRIGHT_TOKEN not set"
	if text := readFile(t, path); !strings.Contains(text, want) {
		t.Fatalf("expected %q in:\n%s", want, text)
	}
}

func TestDormancyReasonNamesOnlyTheMissingVariable(t *testing.T) {
	path := filepath.Join(t.TempDir(), "adapter.log")
	log := OpenDebugLog(path, "test")
	if client := fromEnvValues("/tmp/x.sock", "", "", Options{Debug: log}); client != nil {
		t.Fatal("expected no client")
	}
	log.Close()
	text := readFile(t, path)
	if !strings.Contains(text, "dormant: TERMWRIGHT_TOKEN not set") {
		t.Fatalf("got:\n%s", text)
	}
}

func TestAProtocolMismatchSaysSo(t *testing.T) {
	path := filepath.Join(t.TempDir(), "adapter.log")
	log := OpenDebugLog(path, "test")
	if client := fromEnvValues("/tmp/x.sock", "token", "termwright/99", Options{Debug: log}); client != nil {
		t.Fatal("expected no client")
	}
	log.Close()
	if text := readFile(t, path); !strings.Contains(text, `dormant: TERMWRIGHT_PROTOCOL="termwright/99"`) {
		t.Fatalf("got:\n%s", text)
	}
}

// The line that would have settled the Windows question by itself.
func TestAFailedDialNamesTheErrorType(t *testing.T) {
	directory := shortTempDir(t)
	path := filepath.Join(directory, "adapter.log")
	log := OpenDebugLog(path, "test")
	client := New(filepath.Join(directory, "absent.sock"), "s3cret-token-value", Options{
		AdapterName: "test", AdapterVersion: "0.0.0", Debug: log,
	})
	if err := client.Start(500 * time.Millisecond); err == nil {
		t.Fatal("expected the dial to fail")
	}
	log.Close()

	text := readFile(t, path)
	if !strings.Contains(text, "dial unix:") {
		t.Fatalf("expected the transport to be named:\n%s", text)
	}
	if !strings.Contains(text, "dial failed, staying dormant: *net.OpError") {
		t.Fatalf("expected the concrete error type:\n%s", text)
	}
	if strings.Contains(text, "s3cret-token-value") {
		t.Fatalf("the token reached the log:\n%s", text)
	}
}

func TestASilentClientWritesNothing(t *testing.T) {
	directory := t.TempDir()
	client := New(filepath.Join(directory, "absent.sock"), "token", Options{AdapterName: "test"})
	_ = client.Start(200 * time.Millisecond)

	entries, err := os.ReadDir(directory)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 0 {
		t.Fatalf("a client with no log left files behind: %v", entries)
	}
}

func readFile(t *testing.T, path string) string {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return string(data)
}
