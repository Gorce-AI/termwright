// A Bubble Tea application whose model declares its own semantics.
//
// Kept separate from fixture-v2, which must import nothing of ours and has a
// test saying so. Annotation is opt-in; the fixture that proves zero-config
// should not be the one that stops being it.
package main

import (
	"fmt"
	"os"

	"charm.land/bubbles/v2/textinput"
	tea "charm.land/bubbletea/v2"

	"github.com/gorce-ai/termwright/clients/go/annotate"
	"github.com/gorce-ai/termwright/clients/go/protocol"
)

// gauge is a component termwright has never heard of. It answers for itself
// rather than being registered: a Bubble Tea component is a value copied on
// every update, so an address recorded once would name a copy that is gone.
type gauge struct {
	Level  int
	Status string
}

func (g gauge) TermwrightSemantics() annotate.Semantics {
	return annotate.Semantics{
		Key:    "disk-gauge",
		Role:   "progressbar",
		Name:   "Disk usage",
		TestID: "disk-gauge",
		Domain: map[string]any{"level": g.Level, "status": g.Status},
	}
}

func (g gauge) View() string {
	return fmt.Sprintf("disk %d%% (%s)", g.Level, g.Status)
}

// annotatedTextInput is the normal Go shape for annotating a type owned by
// another module: embed the native Bubbles value and add the provider method
// on the local wrapper. The probe must merge this intent with the embedded
// component's live value and focus rather than replacing it with a generic
// annotation-only node.
type annotatedTextInput struct {
	textinput.Model
}

func (annotatedTextInput) TermwrightSemantics() annotate.Semantics {
	return annotate.Semantics{
		Key:         "server-host",
		Name:        "Server host",
		TestID:      "server-host",
		Domain:      map[string]any{"environment": "production"},
		Actions:     []protocol.Action{protocol.ActionFocus, protocol.ActionSetValue},
		LabelledBy:  []annotate.SemanticKey{"server-label"},
		DescribedBy: []annotate.SemanticKey{"server-help"},
	}
}

// semanticText supplies relationship targets. They are ordinary copied model
// values; explicit keys, not addresses, are the identity that survives Update.
type semanticText struct {
	Key  annotate.SemanticKey
	Name string
	Text string
}

func (text semanticText) TermwrightSemantics() annotate.Semantics {
	return annotate.Semantics{Key: text.Key, Role: "text", Name: text.Name}
}

func (text semanticText) View() string { return text.Text }

type model struct {
	// Host deliberately precedes its relationship targets. Resolution must be
	// a second pass over semantic keys, not an accident of reflection order.
	Host      annotatedTextInput
	HostLabel semanticText
	HostHelp  semanticText
	Gauge     gauge
}

func initialModel() model {
	host := textinput.New()
	host.Placeholder = "host"
	host.Focus()
	return model{
		Host:      annotatedTextInput{Model: host},
		HostLabel: semanticText{Key: "server-label", Name: "Server host", Text: "Server host"},
		HostHelp:  semanticText{Key: "server-help", Name: "DNS host name", Text: "DNS host name"},
		Gauge:     gauge{Level: 81, Status: "warning"},
	}
}

func (m model) Init() tea.Cmd { return textinput.Blink }

func (m model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	if key, ok := msg.(tea.KeyPressMsg); ok {
		switch key.String() {
		case "ctrl+c", "esc":
			return m, tea.Quit
		case "+":
			m.Gauge.Level++
			return m, nil
		}
	}
	var command tea.Cmd
	m.Host.Model, command = m.Host.Model.Update(msg)
	return m, command
}

func (m model) View() tea.View {
	return tea.NewView(fmt.Sprintf("%s\n%s\n%s\n%s\n", m.HostLabel.View(), m.Host.View(), m.HostHelp.View(), m.Gauge.View()))
}

func main() {
	if _, err := tea.NewProgram(initialModel()).Run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
