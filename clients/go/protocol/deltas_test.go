package protocol

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

type composeCase struct {
	Name           string         `json:"name"`
	Rule           string         `json:"rule"`
	Base           map[string]any `json:"base"`
	Delta          map[string]any `json:"delta"`
	LimitsOverride map[string]int `json:"limitsOverride"`
	Expect         struct {
		OK       bool           `json:"ok"`
		Snapshot map[string]any `json:"snapshot"`
		Code     string         `json:"code"`
		Detail   string         `json:"detail"`
	} `json:"expect"`
}

func loadComposeCases(t *testing.T) []composeCase {
	t.Helper()
	body, err := os.ReadFile(filepath.Join("..", "..", "test-vectors", "deltas.json"))
	if err != nil {
		t.Fatalf("reading delta vectors: %v", err)
	}
	var file struct {
		Cases []composeCase `json:"cases"`
	}
	if err := json.Unmarshal(body, &file); err != nil {
		t.Fatalf("parsing delta vectors: %v", err)
	}
	return file.Cases
}

// limitsFor merges the case's override onto DefaultLimits, as the vectors define.
func limitsFor(t *testing.T, testCase composeCase) Limits {
	t.Helper()
	limits := DefaultLimits
	if testCase.LimitsOverride == nil {
		return limits
	}
	body, err := json.Marshal(DefaultLimits)
	if err != nil {
		t.Fatal(err)
	}
	var merged map[string]any
	if err := json.Unmarshal(body, &merged); err != nil {
		t.Fatal(err)
	}
	for key, value := range testCase.LimitsOverride {
		merged[key] = value
	}
	body, err = json.Marshal(merged)
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(body, &limits); err != nil {
		t.Fatal(err)
	}
	return limits
}

// nodesByID keys the nodes so they can be compared as a set. The order of
// `nodes` in a composed snapshot is NOT normative: the reference composes
// through an insertion-ordered map, a client backed by a hash map reports
// another order, and both are correct.
func nodesByID(t *testing.T, snapshot map[string]any) map[string]string {
	t.Helper()
	out := map[string]string{}
	nodes, _ := snapshot["nodes"].([]any)
	for _, raw := range nodes {
		node, _ := raw.(map[string]any)
		body, err := json.Marshal(node)
		if err != nil {
			t.Fatal(err)
		}
		out[stringOr(node["id"])] = string(body)
	}
	return out
}

func TestCompositionMatchesTheReference(t *testing.T) {
	for _, testCase := range loadComposeCases(t) {
		t.Run(testCase.Name, func(t *testing.T) {
			limits := limitsFor(t, testCase)

			// Every fixture's delta is shape-valid; composition is under test.
			if err := ValidateTreeDelta(testCase.Delta, limits); err != nil {
				t.Fatalf("fixture delta is malformed: %v", err)
			}

			composed, err := ApplyTreeDelta(testCase.Base, testCase.Delta, limits)
			if !testCase.Expect.OK {
				if err == nil {
					t.Fatal("a composition that should have failed produced a tree")
				}
				if code := ValidationCode(err); code != testCase.Expect.Code {
					t.Errorf("code %q, want %q (%v)", code, testCase.Expect.Code, err)
				}
				return
			}
			if err != nil {
				t.Fatalf("composition failed: %v", err)
			}

			got, want := nodesByID(t, composed), nodesByID(t, testCase.Expect.Snapshot)
			if len(got) != len(want) {
				t.Fatalf("composed %d nodes, want %d", len(got), len(want))
			}
			for id, node := range want {
				if got[id] != node {
					t.Errorf("node %s differs\n got %s\nwant %s", id, got[id], node)
				}
			}
			if composed["revision"] != testCase.Expect.Snapshot["revision"] {
				t.Errorf("revision %v, want %v", composed["revision"], testCase.Expect.Snapshot["revision"])
			}
			gotCursor, _ := json.Marshal(composed["cursor"])
			wantCursor, _ := json.Marshal(testCase.Expect.Snapshot["cursor"])
			if string(gotCursor) != string(wantCursor) {
				t.Errorf("cursor %s, want %s", gotCursor, wantCursor)
			}
		})
	}
}

// TestAnUpsertReplacesANodeRatherThanMergingIt is the single most likely place
// to diverge: a merging implementation passes every other case in the file and
// fails only here, because `state` survives when it should have been replaced
// away.
func TestAnUpsertReplacesANodeRatherThanMergingIt(t *testing.T) {
	testCase := findCase(t, "upsert-replaces-node-wholesale")
	composed, err := ApplyTreeDelta(testCase.Base, testCase.Delta, DefaultLimits)
	if err != nil {
		t.Fatal(err)
	}
	for _, raw := range composed["nodes"].([]any) {
		node := raw.(map[string]any)
		if stringOr(node["id"]) != "approve" {
			continue
		}
		if _, present := node["state"]; present {
			t.Errorf("state survived a wholesale replacement: %v", node)
		}
		return
	}
	t.Error("the replaced node vanished")
}

func TestARemovalTakesTheWholeSubtree(t *testing.T) {
	testCase := findCase(t, "remove-cascades-to-the-subtree")
	composed, err := ApplyTreeDelta(testCase.Base, testCase.Delta, DefaultLimits)
	if err != nil {
		t.Fatal(err)
	}
	// Dropping the dialog costs one id and takes its three descendants with it.
	if got := nodesByID(t, composed); len(got) != 1 || got["root"] == "" {
		t.Errorf("survivors are %v", keysOfStrings(got))
	}
	if removed := testCase.Delta["removed"].([]any); len(removed) != 1 {
		t.Errorf("the fixture no longer proves the cascade: %v", removed)
	}
}

func TestRemovalsAreAppliedBeforeUpserts(t *testing.T) {
	testCase := findCase(t, "rescue-a-node-out-of-a-removed-subtree")
	composed, err := ApplyTreeDelta(testCase.Base, testCase.Delta, DefaultLimits)
	if err != nil {
		t.Fatal(err)
	}
	got := nodesByID(t, composed)
	if len(got) != 2 || got["root"] == "" || got["approve"] == "" {
		t.Fatalf("survivors are %v", keysOfStrings(got))
	}
	for _, raw := range composed["nodes"].([]any) {
		node := raw.(map[string]any)
		if stringOr(node["id"]) == "approve" && node["parentId"] != "root" {
			t.Errorf("the rescued node kept its old parent: %v", node["parentId"])
		}
	}
}

func TestADisagreeingBaseIsReportedNotPatched(t *testing.T) {
	for _, name := range []string{"base-revision-mismatch-resyncs", "base-revision-ahead-resyncs"} {
		testCase := findCase(t, name)
		_, err := ApplyTreeDelta(testCase.Base, testCase.Delta, DefaultLimits)
		if ValidationCode(err) != "revision" {
			t.Errorf("%s: code %q, want revision", name, ValidationCode(err))
		}
	}
}

func findCase(t *testing.T, name string) composeCase {
	t.Helper()
	for _, testCase := range loadComposeCases(t) {
		if testCase.Name == name {
			return testCase
		}
	}
	t.Fatalf("vector %q is missing", name)
	return composeCase{}
}

func keysOfStrings(m map[string]string) []string {
	out := make([]string, 0, len(m))
	for key := range m {
		out = append(out, key)
	}
	return out
}

// -- producing deltas, with composition as the oracle ----------------------

func wireTree(t *testing.T, revision int64, nodes []any, rootIDs []any, cursor map[string]any) map[string]any {
	t.Helper()
	tree := map[string]any{
		"v": float64(1), "sessionId": "s-1", "revision": float64(revision),
		"columns": float64(80), "rows": float64(24),
		"rootIds": rootIDs, "nodes": nodes,
	}
	if cursor != nil {
		tree["cursor"] = cursor
	}
	return tree
}

func node(id, parent, name string) map[string]any {
	out := map[string]any{"id": id, "role": "button", "name": name}
	if parent != "" {
		out["parentId"] = parent
	}
	return out
}

func baseTree(t *testing.T) map[string]any {
	t.Helper()
	return wireTree(t, 1, []any{
		map[string]any{"id": "root", "role": "region", "name": "main"},
		map[string]any{"id": "dialog", "parentId": "root", "role": "dialog", "name": "Permission"},
		node("ok", "dialog", "Approve"),
		node("no", "dialog", "Reject"),
	}, []any{"root"}, nil)
}

// assertRoundTrips is the oracle: whatever the producer emits must compose
// back into exactly the tree it claims to describe.
func assertRoundTrips(t *testing.T, base, wanted map[string]any) map[string]any {
	t.Helper()
	delta := BuildDelta(base, wanted)
	if delta == nil {
		t.Fatal("expected a delta, got a snapshot fallback")
	}
	if err := ValidateTreeDelta(delta, DefaultLimits); err != nil {
		t.Fatalf("the produced delta is malformed: %v", err)
	}
	composed, err := ApplyTreeDelta(base, delta, DefaultLimits)
	if err != nil {
		t.Fatalf("composing it back failed: %v", err)
	}
	got, want := nodesByID(t, composed), nodesByID(t, wanted)
	if len(got) != len(want) {
		t.Fatalf("composed %d nodes, want %d", len(got), len(want))
	}
	for id, body := range want {
		if got[id] != body {
			t.Errorf("node %s differs\n got %s\nwant %s", id, got[id], body)
		}
	}
	return delta
}

func TestAChangedNodeRoundTrips(t *testing.T) {
	base := baseTree(t)
	changed := node("ok", "dialog", "Approve")
	changed["state"] = map[string]any{"focused": true}
	wanted := wireTree(t, 2, []any{
		map[string]any{"id": "root", "role": "region", "name": "main"},
		map[string]any{"id": "dialog", "parentId": "root", "role": "dialog", "name": "Permission"},
		changed,
		node("no", "dialog", "Reject"),
	}, []any{"root"}, nil)

	delta := assertRoundTrips(t, base, wanted)
	if got := delta["changed"].([]any); len(got) != 1 {
		t.Errorf("%d nodes travelled, want 1", len(got))
	}
}

func TestARemovedSubtreeCostsOneID(t *testing.T) {
	base := baseTree(t)
	wanted := wireTree(t, 2, []any{
		map[string]any{"id": "root", "role": "region", "name": "main"},
	}, []any{"root"}, nil)

	delta := assertRoundTrips(t, base, wanted)
	removed := delta["removed"].([]any)
	if len(removed) != 1 || removed[0] != "dialog" {
		t.Errorf("removed %v, want just the dialog", removed)
	}
}

// TestASurvivorUnderARemovedParentIsResent is the failure that produces a tree
// the driver believes and the screen contradicts: the node is unchanged, so a
// naive diff omits it, and the removal of its old parent quietly deletes it.
func TestASurvivorUnderARemovedParentIsResent(t *testing.T) {
	base := baseTree(t)
	wanted := wireTree(t, 2, []any{
		map[string]any{"id": "root", "role": "region", "name": "main"},
		node("ok", "root", "Approve"),
	}, []any{"root"}, nil)

	delta := assertRoundTrips(t, base, wanted)
	if got := delta["changed"].([]any); len(got) != 1 {
		t.Fatalf("changed carries %d nodes, want the rescued one", len(got))
	}
}

func TestANewRootCarriesTheRootList(t *testing.T) {
	base := baseTree(t)
	nodes := append(base["nodes"].([]any), map[string]any{"id": "aside", "role": "region", "name": "Aside"})
	wanted := wireTree(t, 2, nodes, []any{"root", "aside"}, nil)

	delta := assertRoundTrips(t, base, wanted)
	if _, present := delta["rootIds"]; !present {
		t.Error("a new root travelled without the root list")
	}
}

func TestAnUnchangedRootListIsNotSent(t *testing.T) {
	base := baseTree(t)
	nodes := append(base["nodes"].([]any), node("note", "dialog", "Note"))
	wanted := wireTree(t, 2, nodes, []any{"root"}, nil)

	delta := BuildDelta(base, wanted)
	if _, present := delta["rootIds"]; present {
		t.Error("the inherited root list was re-sent")
	}
}

func TestACursorThatDisappearsForcesAWholeTree(t *testing.T) {
	withCursor := baseTree(t)
	withCursor["cursor"] = map[string]any{"row": float64(1), "column": float64(1), "visible": true}
	without := wireTree(t, 2, withCursor["nodes"].([]any), []any{"root"}, nil)

	if BuildDelta(withCursor, without) != nil {
		t.Error("a delta claimed to remove a cursor, which it cannot express")
	}
}

func TestARewriteOfMostOfTheTreeFallsBackToASnapshot(t *testing.T) {
	base := baseTree(t)
	wanted := wireTree(t, 2, []any{
		map[string]any{"id": "root", "role": "region", "name": "renamed"},
		map[string]any{"id": "dialog", "parentId": "root", "role": "dialog", "name": "renamed"},
		node("ok", "dialog", "renamed"),
		node("no", "dialog", "renamed"),
	}, []any{"root"}, nil)

	if BuildDelta(base, wanted) != nil {
		t.Error("a near-total rewrite was sent as a delta")
	}
}
