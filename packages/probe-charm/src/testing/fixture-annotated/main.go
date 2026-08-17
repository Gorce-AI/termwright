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
		Role:   "progressbar",
		Name:   "Disk usage",
		TestID: "disk-gauge",
		Domain: map[string]string{"level": fmt.Sprint(g.Level), "status": g.Status},
	}
}

func (g gauge) View() string {
	return fmt.Sprintf("disk %d%% (%s)", g.Level, g.Status)
}

type model struct {
	Host  textinput.Model
	Gauge gauge
}

func initialModel() model {
	host := textinput.New()
	host.Placeholder = "host"
	host.Focus()
	return model{Host: host, Gauge: gauge{Level: 81, Status: "warning"}}
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
	m.Host, command = m.Host.Update(msg)
	return m, command
}

func (m model) View() tea.View {
	return tea.NewView(fmt.Sprintf("Server\n\n%s\n%s\n", m.Host.View(), m.Gauge.View()))
}

func main() {
	if _, err := tea.NewProgram(initialModel()).Run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
