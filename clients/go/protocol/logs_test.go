package protocol

import (
	"context"
	"log/slog"
	"testing"
	"time"
)

var testBudget = &LogBudget{Enabled: true, MaxRecordsPerSecond: 100, Burst: 50}

// connectedClient returns a live client whose driver granted (or withheld) a
// log budget.
func connectedClient(t *testing.T, budget *LogBudget) (*fakeDriver, *Client) {
	t.Helper()
	driver := startFakeDriverWithLogs(t, budget)
	client := New(driver.endpoint(), testToken, Options{
		AdapterName: "go-test", AdapterVersion: "0.1.0", Capabilities: CapabilitiesWithLogs,
	})
	if err := client.Start(2 * time.Second); err != nil {
		t.Fatalf("handshake failed: %v", err)
	}
	t.Cleanup(func() { _ = client.Close() })
	return driver, client
}

func logFrames(frames []map[string]any) []map[string]any {
	var out []map[string]any
	for _, frame := range frames {
		if frame["type"] == "log" {
			out = append(out, frame["record"].(map[string]any))
		}
	}
	return out
}

// -- the closed ladder -----------------------------------------------------

func TestSlogLevelsMapOntoTheWireLadder(t *testing.T) {
	cases := []struct {
		level slog.Level
		want  LogLevel
	}{
		{slog.LevelDebug - 4, LevelTrace},
		{slog.LevelDebug, LevelDebug},
		{slog.LevelInfo, LevelInfo},
		{slog.LevelWarn, LevelWarn},
		{slog.LevelError, LevelError},
		{slog.LevelError + 4, LevelFatal},
	}
	for _, testCase := range cases {
		if got := LevelForSlog(testCase.level); got != testCase.want {
			t.Errorf("slog level %v mapped to %q, want %q", testCase.level, got, testCase.want)
		}
	}
}

func TestNestedAttrsAreFlattenedToDottedKeys(t *testing.T) {
	flat := FlattenAttrs(map[string]any{
		"db": map[string]any{"host": "localhost", "port": 5432},
		"ok": true,
	})
	if flat["db.host"] != "localhost" || flat["db.port"] != 5432 || flat["ok"] != true {
		t.Fatalf("flattening produced %v", flat)
	}
	record := &LogRecord{TS: 1, Level: LevelInfo, Message: "x", Seq: 0, Attrs: flat}
	if err := record.Validate(DefaultLimits); err != nil {
		t.Errorf("a flattened record was rejected: %v", err)
	}
}

// -- the dormant and unbudgeted paths --------------------------------------

func TestNoBudgetMeansNoLogs(t *testing.T) {
	_, client := connectedClient(t, nil)
	if client.LogBudget() != nil {
		t.Fatal("a budget appeared without one being granted")
	}
	if client.Log(LevelError, "should not be sent", nil) {
		t.Error("a record went out without a budget")
	}
}

func TestADisabledBudgetIsAlsoSilence(t *testing.T) {
	_, client := connectedClient(t, &LogBudget{Enabled: false, MaxRecordsPerSecond: 100, Burst: 10})
	if client.Log(LevelError, "should not be sent", nil) {
		t.Error("a record went out under a disabled budget")
	}
}

func TestANilClientHandlerIsNeverEnabled(t *testing.T) {
	handler := NewSlogHandler(nil, nil)
	if handler.Enabled(context.Background(), slog.LevelError) {
		t.Error("the dormant handler asked for records")
	}
	// And handling one anyway must not panic.
	logger := slog.New(handler)
	logger.Error("into the void")
}

// -- the happy path --------------------------------------------------------

func TestRecordsReachTheDriverAndValidate(t *testing.T) {
	driver, client := connectedClient(t, testBudget)
	if !client.Log(LevelError, "connection refused", map[string]any{
		"db": map[string]any{"host": "localhost"},
	}) {
		t.Fatal("the record was dropped")
	}

	records := logFrames(driver.waitFor(t, 2)) // hello + log
	if len(records) != 1 {
		t.Fatalf("got %d log records", len(records))
	}
	if err := ValidateLogRecord(records[0], DefaultLimits); err != nil {
		t.Fatalf("the published record is invalid: %v", err)
	}
	if records[0]["level"] != "error" {
		t.Errorf("level is %v", records[0]["level"])
	}
	attrs := records[0]["attrs"].(map[string]any)
	if attrs["db.host"] != "localhost" {
		t.Errorf("attrs are %v", attrs)
	}
	if ts := records[0]["ts"].(float64); ts < 1_600_000_000_000 {
		t.Errorf("ts %v is not epoch milliseconds", ts)
	}
}

func TestSequenceNumbersAreDenseWhenNothingIsDropped(t *testing.T) {
	driver, client := connectedClient(t, testBudget)
	for index := 0; index < 5; index++ {
		if !client.Log(LevelInfo, "line", nil) {
			t.Fatalf("record %d was dropped", index)
		}
	}
	records := logFrames(driver.waitFor(t, 6))
	for index, record := range records {
		if record["seq"].(float64) != float64(index+1) {
			t.Errorf("record %d carries seq %v", index, record["seq"])
		}
	}
}

// -- dropping, and the gap it leaves ---------------------------------------

// TestGoingOverBudgetDropsLocallyAndLeavesAGap: the gap in seq is how the
// driver learns records died here rather than in transit. Renumbering after a
// drop would hide exactly the loss the counter exists to report.
func TestGoingOverBudgetDropsLocallyAndLeavesAGap(t *testing.T) {
	driver, client := connectedClient(t, &LogBudget{Enabled: true, MaxRecordsPerSecond: 20, Burst: 2})

	delivered := 0
	for index := 0; index < 40; index++ {
		if client.Log(LevelInfo, "burst", nil) {
			delivered++
		}
	}
	if delivered >= 40 {
		t.Fatal("the rate limit never engaged")
	}
	if dropped := client.LogsDropped(); dropped != int64(40-delivered) {
		t.Errorf("dropped %d, delivered %d of 40", dropped, delivered)
	}

	time.Sleep(300 * time.Millisecond) // let the bucket refill
	if !client.Log(LevelInfo, "after the refill", nil) {
		t.Fatal("the bucket never refilled")
	}

	records := logFrames(driver.waitFor(t, delivered+2))
	var highest float64
	seen := map[float64]bool{}
	for _, record := range records {
		seq := record["seq"].(float64)
		if seen[seq] {
			t.Errorf("sequence number %v repeated", seq)
		}
		seen[seq] = true
		if seq < highest {
			t.Errorf("sequence numbers went backwards at %v", seq)
		}
		highest = seq
	}
	if highest <= float64(len(records)) {
		t.Errorf("highest seq %v with %d records: a drop must consume its number", highest, len(records))
	}
	if highest != 41 {
		t.Errorf("the record after the refill carries seq %v, want 41", highest)
	}
}

func TestAnOversizedRecordIsDroppedNotSent(t *testing.T) {
	driver, client := connectedClient(t, testBudget)
	huge := make([]byte, DefaultLimits.MaxLogRecordBytes+10)
	for index := range huge {
		huge[index] = 'x'
	}
	if client.Log(LevelInfo, string(huge), nil) {
		t.Fatal("an oversized record was sent")
	}
	if client.LogsDropped() != 1 {
		t.Errorf("the drop was not counted: %d", client.LogsDropped())
	}

	if !client.Log(LevelInfo, "small enough", nil) {
		t.Fatal("the next record was dropped too")
	}
	records := logFrames(driver.waitFor(t, 2))
	if len(records) != 1 {
		t.Fatalf("got %d records", len(records))
	}
	if records[0]["seq"].(float64) != 2 {
		t.Errorf("the dropped record did not consume its number: seq %v", records[0]["seq"])
	}
}

// -- the slog bridge -------------------------------------------------------

func TestTheHandlerForwardsWhatTheApplicationAlreadyLogs(t *testing.T) {
	driver, client := connectedClient(t, testBudget)
	logger := slog.New(NewSlogHandler(client, nil)).With("logger", "db.pool")

	logger.Error("disk almost full", "free_bytes", 512, slog.Group("mount", "path", "/"))

	records := logFrames(driver.waitFor(t, 2))
	if len(records) != 1 {
		t.Fatalf("got %d records", len(records))
	}
	record := records[0]
	if record["level"] != "error" || record["message"] != "disk almost full" {
		t.Errorf("record is %v", record)
	}
	if record["logger"] != "db.pool" {
		t.Errorf("logger is %v", record["logger"])
	}
	attrs := record["attrs"].(map[string]any)
	if attrs["free_bytes"].(float64) != 512 || attrs["mount.path"] != "/" {
		t.Errorf("attrs are %v", attrs)
	}
	if err := ValidateLogRecord(record, DefaultLimits); err != nil {
		t.Errorf("the bridged record is invalid: %v", err)
	}
}

func TestHandlerGroupsBecomeDottedKeys(t *testing.T) {
	driver, client := connectedClient(t, testBudget)
	logger := slog.New(NewSlogHandler(client, nil)).WithGroup("http").With("status", 500)
	logger.Warn("slow response", "ms", 1200)

	records := logFrames(driver.waitFor(t, 2))
	if len(records) != 1 {
		t.Fatalf("got %d records", len(records))
	}
	attrs := records[0]["attrs"].(map[string]any)
	if attrs["http.status"].(float64) != 500 || attrs["http.ms"].(float64) != 1200 {
		t.Errorf("grouped attrs are %v", attrs)
	}
}

func TestHandlerLevelFiltersBeforeTheBudgetDoes(t *testing.T) {
	_, client := connectedClient(t, testBudget)
	handler := NewSlogHandler(client, &SlogHandlerOptions{Level: slog.LevelWarn})
	if handler.Enabled(context.Background(), slog.LevelInfo) {
		t.Error("info passed a warn-level handler")
	}
	if !handler.Enabled(context.Background(), slog.LevelError) {
		t.Error("error was filtered by a warn-level handler")
	}
}
