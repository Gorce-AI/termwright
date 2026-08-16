package termwright

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gdamore/tcell/v2"
	"github.com/rivo/tview"

	"github.com/gorce-ai/termwright/clients/go/protocol"
)

const (
	testToken   = "test-token"
	testSession = "s-7"
)

// fakeDriver is the driver end: it completes the handshake and records frames.
type fakeDriver struct {
	listener net.Listener
	mu       sync.Mutex
	frames   []map[string]any
	arrived  chan struct{}
}

func startFakeDriver(t *testing.T) *fakeDriver {
	t.Helper()
	dir, err := os.MkdirTemp("/tmp", "tw")
	if err != nil {
		t.Fatalf("creating a socket directory: %v", err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(dir) })

	listener, err := net.Listen("unix", filepath.Join(dir, "s"))
	if err != nil {
		t.Fatalf("listening: %v", err)
	}
	t.Cleanup(func() { _ = listener.Close() })

	driver := &fakeDriver{listener: listener, arrived: make(chan struct{}, 64)}
	go driver.serve()
	return driver
}

func (d *fakeDriver) endpoint() string { return d.listener.Addr().String() }

func (d *fakeDriver) serve() {
	conn, err := d.listener.Accept()
	if err != nil {
		return
	}
	decoder := protocol.NewDecoder(protocol.DefaultLimits.MaxFrameBytes, protocol.DefaultLimits.MaxDepth)
	buffer := make([]byte, 64*1024)
	for {
		n, readErr := conn.Read(buffer)
		if n > 0 {
			frames, decodeErr := decoder.Push(buffer[:n])
			if decodeErr != nil {
				return
			}
			for _, frame := range frames {
				message, _ := frame.Value.(map[string]any)
				if message["type"] == "hello" {
					ack, _ := protocol.EncodeFrame(protocol.HelloAck{
						Type:      "hello-ack",
						Protocol:  protocol.ProtocolID,
						SessionID: testSession,
						Limits:    protocol.DefaultLimits,
						Subscribe: "snapshots",
						Marker:    protocol.MarkerConfig{Enabled: true},
					}, protocol.DefaultLimits.MaxFrameBytes)
					_, _ = conn.Write(ack)
				}
				d.mu.Lock()
				d.frames = append(d.frames, message)
				d.mu.Unlock()
				select {
				case d.arrived <- struct{}{}:
				default:
				}
			}
		}
		if readErr != nil {
			return
		}
	}
}

// waitForSnapshot blocks until a snapshot frame arrives and returns its body.
func (d *fakeDriver) waitForSnapshot(t *testing.T) map[string]any {
	t.Helper()
	deadline := time.After(3 * time.Second)
	for {
		d.mu.Lock()
		for _, frame := range d.frames {
			if frame["type"] == "snapshot" {
				body := frame["snapshot"].(map[string]any)
				d.mu.Unlock()
				return body
			}
		}
		d.mu.Unlock()
		select {
		case <-d.arrived:
		case <-deadline:
			t.Fatal("no snapshot arrived")
		}
	}
}

func demoApp() (*tview.Application, tview.Primitive, *tview.Button) {
	app := tview.NewApplication()
	approve := tview.NewButton("Approve")
	reject := tview.NewButton("Reject").SetDisabled(true)
	reason := tview.NewInputField().SetLabel("Reason")
	prompt := tview.NewTextView().SetText("Allow bash to run?")
	list := tview.NewList().AddItem("first", "", 0, nil).AddItem("second", "", 0, nil)

	root := tview.NewFlex().SetDirection(tview.FlexRow).
		AddItem(prompt, 1, 0, false).
		AddItem(approve, 1, 0, true).
		AddItem(reject, 1, 0, false).
		AddItem(reason, 1, 0, false).
		AddItem(list, 4, 0, false)
	root.SetTitle("Permission")
	return app, root, approve
}

// -- dormant rule ----------------------------------------------------------

func TestAttachIsDormantWithoutTheDriverEnvironment(t *testing.T) {
	t.Setenv(protocol.EnvEndpoint, "")
	t.Setenv(protocol.EnvToken, "")

	app, root, _ := demoApp()
	session, err := Attach(app, root)
	if err != nil {
		t.Fatalf("dormant attach returned an error: %v", err)
	}
	if session != nil {
		t.Fatal("a session was created without an endpoint")
	}
	// A nil session must stay safe to use.
	if session.Client() != nil {
		t.Error("a nil session produced a client")
	}
	if err := session.Close(); err != nil {
		t.Errorf("closing a nil session failed: %v", err)
	}
}

// -- publishing ------------------------------------------------------------

func TestAttachPublishesTheTreeAndCommitsWithAMarker(t *testing.T) {
	driver := startFakeDriver(t)
	t.Setenv(protocol.EnvEndpoint, driver.endpoint())
	t.Setenv(protocol.EnvToken, testToken)

	app, root, _ := demoApp()
	markers := &syncBuffer{}
	screen := tcell.NewSimulationScreen("UTF-8")
	screen.SetSize(80, 24)

	session, err := Attach(app, root, WithScreen(screen), WithMarkerWriter(markers))
	if err != nil {
		t.Fatalf("attach failed: %v", err)
	}
	if session == nil {
		t.Fatal("an instrumented environment produced no session")
	}
	defer session.Close()

	done := make(chan error, 1)
	go func() { done <- app.SetRoot(root, true).Run() }()
	defer func() {
		app.Stop()
		<-done
	}()

	// Redraw until the handshake lands and a frame is published.
	deadline := time.After(3 * time.Second)
	for !session.Client().Connected() {
		select {
		case <-deadline:
			t.Fatal("the handshake never completed")
		case <-time.After(10 * time.Millisecond):
			app.Draw()
		}
	}
	app.Draw()

	snapshot := driver.waitForSnapshot(t)
	if err := protocol.ValidateSnapshot(snapshot, protocol.DefaultLimits); err != nil {
		t.Fatalf("published snapshot is invalid: %v", err)
	}
	if snapshot["sessionId"] != testSession {
		t.Errorf("snapshot bound to session %v", snapshot["sessionId"])
	}

	nodes := snapshot["nodes"].([]any)
	found := map[string]map[string]any{}
	for _, raw := range nodes {
		node := raw.(map[string]any)
		found[node["role"].(string)+"/"+node["name"].(string)] = node
	}
	for _, want := range []string{"button/Approve", "button/Reject", "textbox/Reason", "text/Allow bash to run?", "listitem/first"} {
		if _, ok := found[want]; !ok {
			t.Errorf("missing node %q; got %v", want, keysOf(found))
		}
	}

	approve := found["button/Approve"]
	bounds, ok := approve["bounds"].(map[string]any)
	if !ok {
		t.Fatal("the focused button published no bounds")
	}
	if bounds["width"].(float64) <= 0 {
		t.Errorf("button bounds are empty: %v", bounds)
	}
	if state, ok := approve["state"].(map[string]any); !ok || state["focused"] != true {
		t.Errorf("the focused button is not marked focused: %v", approve["state"])
	}
	if state, ok := found["button/Reject"]["state"].(map[string]any); !ok || state["disabled"] != true {
		t.Errorf("the disabled button is not marked disabled: %v", found["button/Reject"]["state"])
	}

	// Rows differ because tview's GetRect is absolute, not parent-relative.
	rejectBounds := found["button/Reject"]["bounds"].(map[string]any)
	if bounds["row"].(float64) == rejectBounds["row"].(float64) {
		t.Errorf("stacked buttons share a row: %v vs %v", bounds, rejectBounds)
	}

	// One marker per committed frame, so take the most recent. Markers are
	// `OSC 8487; … BEL`, so BEL is the separator.
	written := strings.Split(strings.TrimSuffix(markers.String(), "\x07"), "\x07")
	if len(written) == 0 || written[0] == "" {
		t.Fatal("no render-commit marker was written")
	}
	last := written[len(written)-1]
	payload := strings.TrimPrefix(last, fmt.Sprintf("\x1b]%d;", protocol.MarkerOSCCode))
	verified, ok := protocol.VerifyMarkerPayload(payload, testToken, testSession)
	if !ok {
		t.Fatalf("the marker %q does not verify", last)
	}
	if verified.Revision != session.Client().Revision() {
		t.Errorf("marker commits revision %d, client is at %d", verified.Revision, session.Client().Revision())
	}
}

func TestTheFirstTreeArrivesWithoutAnyInteraction(t *testing.T) {
	driver := startFakeDriver(t)
	t.Setenv(protocol.EnvEndpoint, driver.endpoint())
	t.Setenv(protocol.EnvToken, testToken)

	app, root, _ := demoApp()
	screen := tcell.NewSimulationScreen("UTF-8")
	screen.SetSize(80, 24)

	session, err := Attach(app, root, WithScreen(screen), WithMarkerWriter(&syncBuffer{}))
	if err != nil || session == nil {
		t.Fatalf("attach failed: %v", err)
	}
	defer session.Close()

	done := make(chan error, 1)
	go func() { done <- app.SetRoot(root, true).Run() }()
	defer func() {
		app.Stop()
		<-done
	}()

	// No key is sent and no redraw is requested: tview draws its first frame
	// before the handshake lands and then sits idle forever, so the adapter
	// itself has to force the frame that carries the first tree. A test that
	// pressed a key here would pass against an adapter that never publishes
	// until the user touches the keyboard.
	snapshot := driver.waitForSnapshot(t)
	if err := protocol.ValidateSnapshot(snapshot, protocol.DefaultLimits); err != nil {
		t.Fatalf("the first published snapshot is invalid: %v", err)
	}
	names := map[string]bool{}
	for _, raw := range snapshot["nodes"].([]any) {
		names[raw.(map[string]any)["name"].(string)] = true
	}
	if !names["Approve"] {
		t.Errorf("the first tree is missing the buttons: %v", names)
	}
}

func TestDescriberOverridesRoleAndName(t *testing.T) {
	driver := startFakeDriver(t)
	t.Setenv(protocol.EnvEndpoint, driver.endpoint())
	t.Setenv(protocol.EnvToken, testToken)

	app, root, approve := demoApp()
	screen := tcell.NewSimulationScreen("UTF-8")
	screen.SetSize(80, 24)

	describe := func(p tview.Primitive) (protocol.Role, string, bool) {
		if p == approve {
			return protocol.RoleAlert, "Disk almost full", true
		}
		return "", "", false
	}

	session, err := Attach(app, root, WithScreen(screen), WithMarkerWriter(&syncBuffer{}), WithDescriber(describe))
	if err != nil || session == nil {
		t.Fatalf("attach failed: %v", err)
	}
	defer session.Close()

	done := make(chan error, 1)
	go func() { done <- app.SetRoot(root, true).Run() }()
	defer func() {
		app.Stop()
		<-done
	}()

	deadline := time.After(3 * time.Second)
	for !session.Client().Connected() {
		select {
		case <-deadline:
			t.Fatal("the handshake never completed")
		case <-time.After(10 * time.Millisecond):
			app.Draw()
		}
	}
	app.Draw()

	snapshot := driver.waitForSnapshot(t)
	var seen bool
	for _, raw := range snapshot["nodes"].([]any) {
		node := raw.(map[string]any)
		if node["name"] == "Disk almost full" && node["role"] == "alert" {
			seen = true
		}
	}
	if !seen {
		t.Error("the describer override did not reach the snapshot")
	}
}

// -- pure tree shape -------------------------------------------------------

func TestUnshownPagesArePublishedAsHidden(t *testing.T) {
	app := tview.NewApplication()

	form := tview.NewForm().
		AddInputField("Name", "", 20, nil, nil).
		AddButton("Save", nil)
	form.SetTitle("Settings")
	menu := tview.NewList().AddItem("Open settings", "", 0, nil)
	menu.SetTitle("Menu")

	pages := tview.NewPages()
	pages.AddPage("main", menu, true, true)
	pages.AddPage("settings", form, true, false)

	session := &Session{app: app, root: pages, ids: make(map[tview.Primitive]string)}
	nodes := map[string]map[string]any{}
	for _, raw := range asWire(t, session.buildSnapshot(80, 24))["nodes"].([]any) {
		node := raw.(map[string]any)
		nodes[node["role"].(string)+"/"+node["name"].(string)] = node
	}

	// Everything under the page that Pages is not showing must say so, or a
	// `toBeVisible` assertion goes green before the screen ever opened.
	for _, name := range []string{"region/Settings", "textbox/Name", "button/Save"} {
		node, found := nodes[name]
		if !found {
			t.Fatalf("node %q is missing; got %v", name, keysOf(nodes))
		}
		state, _ := node["state"].(map[string]any)
		if state == nil || state["hidden"] != true {
			t.Errorf("%q is on an unshown page but published state %v", name, node["state"])
		}
	}

	// The shown page stays visible.
	menuNode, found := nodes["list/Menu"]
	if !found {
		t.Fatalf("the shown page is missing; got %v", keysOf(nodes))
	}
	if state, _ := menuNode["state"].(map[string]any); state != nil && state["hidden"] == true {
		t.Errorf("the shown page was published as hidden: %v", menuNode["state"])
	}
	if item, found := nodes["listitem/Open settings"]; !found {
		t.Error("the shown list published no items")
	} else if state, _ := item["state"].(map[string]any); state != nil && state["hidden"] == true {
		t.Errorf("an item of the shown list was published as hidden: %v", item["state"])
	}
}

func TestSwitchingPagesMovesTheHiddenFlag(t *testing.T) {
	app := tview.NewApplication()
	first := tview.NewTextView().SetText("first")
	second := tview.NewTextView().SetText("second")
	pages := tview.NewPages()
	pages.AddPage("first", first, true, true)
	pages.AddPage("second", second, true, false)

	session := &Session{app: app, root: pages, ids: make(map[tview.Primitive]string)}

	hiddenNames := func() map[string]bool {
		out := map[string]bool{}
		for _, raw := range asWire(t, session.buildSnapshot(80, 24))["nodes"].([]any) {
			node := raw.(map[string]any)
			state, _ := node["state"].(map[string]any)
			out[node["name"].(string)] = state != nil && state["hidden"] == true
		}
		return out
	}

	before := hiddenNames()
	if before["first"] || !before["second"] {
		t.Fatalf("initial visibility is wrong: %v", before)
	}

	pages.SwitchToPage("second")
	after := hiddenNames()
	if !after["first"] || after["second"] {
		t.Errorf("visibility did not follow the page switch: %v", after)
	}
}

func TestSuppliedChildrenAreNotAssumedHidden(t *testing.T) {
	app := tview.NewApplication()
	header := tview.NewTextView().SetText("header")
	grid := tview.NewGrid().AddItem(header, 0, 0, 1, 1, 0, 0, false)

	session := &Session{
		app:  app,
		root: grid,
		ids:  make(map[tview.Primitive]string),
		config: config{children: func(p tview.Primitive) []tview.Primitive {
			if p == grid {
				return []tview.Primitive{header}
			}
			return nil
		}},
	}

	for _, raw := range asWire(t, session.buildSnapshot(80, 24))["nodes"].([]any) {
		node := raw.(map[string]any)
		if node["name"] != "header" {
			continue
		}
		if state, _ := node["state"].(map[string]any); state != nil && state["hidden"] == true {
			t.Errorf("a WithChildren-supplied child was published as hidden: %v", node["state"])
		}
		return
	}
	t.Error("the supplied child never reached the snapshot")
}

// asWire round-trips a snapshot through JSON, which is what the driver sees.
func asWire(t *testing.T, snapshot *protocol.Snapshot) map[string]any {
	t.Helper()
	snapshot.SessionID = "s-test"
	snapshot.Revision = 1
	if err := snapshot.Validate(protocol.DefaultLimits); err != nil {
		t.Fatalf("built an invalid snapshot: %v", err)
	}
	body, err := json.Marshal(snapshot)
	if err != nil {
		t.Fatal(err)
	}
	var wire map[string]any
	if err := json.Unmarshal(body, &wire); err != nil {
		t.Fatal(err)
	}
	return wire
}

func TestRoleMappingOfBareWidgets(t *testing.T) {
	cases := []struct {
		primitive tview.Primitive
		role      protocol.Role
	}{
		{tview.NewButton("ok"), protocol.RoleButton},
		{tview.NewInputField(), protocol.RoleTextbox},
		{tview.NewTextArea(), protocol.RoleTextbox},
		{tview.NewCheckbox(), protocol.RoleCheckbox},
		{tview.NewList(), protocol.RoleList},
		{tview.NewDropDown(), protocol.RoleList},
		{tview.NewTable(), protocol.RoleTable},
		{tview.NewTextView(), protocol.RoleText},
		{tview.NewModal(), protocol.RoleDialog},
		{tview.NewFlex(), protocol.RoleRegion},
		{tview.NewGrid(), protocol.RoleRegion},
		{tview.NewBox(), protocol.RoleRegion},
	}
	for _, testCase := range cases {
		if got := roleOf(testCase.primitive); got != testCase.role {
			t.Errorf("%T mapped to %q, want %q", testCase.primitive, got, testCase.role)
		}
	}
}

func TestNamesComeFromLabelsThenTitles(t *testing.T) {
	if got := nameOf(tview.NewButton("Save")); got != "Save" {
		t.Errorf("button name %q", got)
	}
	if got := nameOf(tview.NewInputField().SetLabel("Email")); got != "Email" {
		t.Errorf("input name %q", got)
	}
	box := tview.NewBox()
	box.SetTitle("Logs")
	if got := nameOf(box); got != "Logs" {
		t.Errorf("box name %q", got)
	}
	if got := nameOf(tview.NewTextView().SetText("  hello  ")); got != "hello" {
		t.Errorf("text view name %q", got)
	}
}

func TestOffscreenPrimitivesPublishNoBounds(t *testing.T) {
	box := tview.NewBox()
	box.SetRect(200, 200, 10, 3)
	if bounds := boundsOf(box, 80, 24); bounds != nil {
		t.Errorf("off-screen primitive published bounds %+v", bounds)
	}
	box.SetRect(0, 0, 0, 0)
	if bounds := boundsOf(box, 80, 24); bounds != nil {
		t.Errorf("zero-sized primitive published bounds %+v", bounds)
	}
	box.SetRect(1, 2, 10, 3)
	bounds := boundsOf(box, 80, 24)
	if bounds == nil || bounds.Column != 1 || bounds.Row != 2 {
		t.Errorf("bounds %+v are not the absolute rect", bounds)
	}
}

// -- helpers ---------------------------------------------------------------

type syncBuffer struct {
	mu     sync.Mutex
	buffer bytes.Buffer
}

func (b *syncBuffer) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buffer.Write(p)
}

func (b *syncBuffer) String() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buffer.String()
}

func keysOf(m map[string]map[string]any) []string {
	out := make([]string, 0, len(m))
	for key := range m {
		out = append(out, key)
	}
	return out
}

// -- the shared adapter conventions ----------------------------------------

// TestAnEmptyFieldPublishesAnEmptyValue pins rule 5: `""` says the field is
// empty, absent says the widget is not value-bearing. Go's omitempty collapses
// the first into the second, which is what made toHaveValue(”) unassertable.
func TestAnEmptyFieldPublishesAnEmptyValue(t *testing.T) {
	app := tview.NewApplication()
	empty := tview.NewInputField().SetLabel("Reason")
	filled := tview.NewInputField().SetLabel("Name").SetText("Ada")
	button := tview.NewButton("Approve")
	root := tview.NewFlex().SetDirection(tview.FlexRow).
		AddItem(empty, 1, 0, false).
		AddItem(filled, 1, 0, false).
		AddItem(button, 1, 0, false)

	session := &Session{app: app, root: root, ids: make(map[tview.Primitive]string)}
	nodes := map[string]map[string]any{}
	for _, raw := range asWire(t, session.buildSnapshot(80, 24))["nodes"].([]any) {
		node := raw.(map[string]any)
		nodes[node["name"].(string)] = node
	}

	value, present := nodes["Reason"]["value"]
	if !present {
		t.Error("an empty textbox published no value at all")
	} else if value != "" {
		t.Errorf("an empty textbox published %q", value)
	}
	if nodes["Name"]["value"] != "Ada" {
		t.Errorf("a filled textbox published %v", nodes["Name"]["value"])
	}
	if _, present := nodes["Approve"]["value"]; present {
		t.Error("a button published a value, but it is not value-bearing")
	}
}

// TestTestIDsComeFromTheAnnotation pins rule 3 for a framework with no native
// identifier: tview offers none, so the annotation is the only source.
func TestTestIDsComeFromTheAnnotation(t *testing.T) {
	app := tview.NewApplication()
	approve := tview.NewButton("Approve")
	reject := tview.NewButton("Reject")
	root := tview.NewFlex().AddItem(approve, 1, 0, true).AddItem(reject, 1, 0, false)

	session := &Session{
		app: app, root: root, ids: make(map[tview.Primitive]string),
		testIDs: make(map[tview.Primitive]string),
		config: config{testID: func(p tview.Primitive) string {
			if p == approve {
				return "approve"
			}
			return ""
		}},
	}
	// The registry covers widgets built far from the Attach call.
	session.SetTestID(reject, "reject")

	ids := map[string]string{}
	for _, raw := range asWire(t, session.buildSnapshot(80, 24))["nodes"].([]any) {
		node := raw.(map[string]any)
		if testID, present := node["testId"]; present {
			ids[node["name"].(string)] = testID.(string)
		}
	}
	if ids["Approve"] != "approve" || ids["Reject"] != "reject" {
		t.Errorf("test ids are %v", ids)
	}

	// Clearing one removes it rather than publishing an empty string.
	session.SetTestID(reject, "")
	for _, raw := range asWire(t, session.buildSnapshot(80, 24))["nodes"].([]any) {
		node := raw.(map[string]any)
		if node["name"] == "Reject" {
			if _, present := node["testId"]; present {
				t.Error("a cleared annotation still published a test id")
			}
		}
	}
}

// weatherGlyph is a primitive tview has never heard of, which is the common
// case: any application with a widget of its own lands on the generic role.
type weatherGlyph struct {
	*tview.Box
}

// A generic node must carry frameworkType, or the driver rejects the whole
// snapshot — not just the one node — so a single unknown widget would silently
// cost the application its entire semantic tree. asWire validates, so this
// test fails at the validation step when the field is missing.
func TestAnUnrecognisedPrimitiveNamesItsOwnType(t *testing.T) {
	app := tview.NewApplication()
	root := &weatherGlyph{Box: tview.NewBox()}
	session := &Session{app: app, root: root, ids: make(map[tview.Primitive]string)}

	var generic []map[string]any
	for _, raw := range asWire(t, session.buildSnapshot(80, 24))["nodes"].([]any) {
		node := raw.(map[string]any)
		if node["role"] == string(protocol.RoleGeneric) {
			generic = append(generic, node)
		}
	}

	if len(generic) == 0 {
		t.Fatal("the fixture no longer produces a generic node")
	}
	for _, node := range generic {
		framework, _ := node["frameworkType"].(string)
		if framework == "" {
			t.Fatalf("generic node %v published no frameworkType", node["id"])
		}
		if !strings.Contains(framework, "weatherGlyph") {
			t.Fatalf("frameworkType %q does not name the widget's own type", framework)
		}
	}
}
