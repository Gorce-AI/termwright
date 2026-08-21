package main

import (
	"fmt"
	"os"

	"charm.land/bubbles/v2/textinput"
	tea "charm.land/bubbletea/v2"
	"github.com/gorce-ai/termwright/clients/go/annotate"
	"github.com/gorce-ai/termwright/clients/go/evidence"
	"github.com/gorce-ai/termwright/clients/go/protocol"
)

const submitRecipient = "k:login-submit"

// submitControl gives the immediate-mode value explicit semantic identity.
// It contains no callback and cannot execute an action.
type submitControl struct{}

func (submitControl) TermwrightSemantics() annotate.Semantics {
	return annotate.Semantics{
		Key:     "login-submit",
		Role:    string(protocol.RoleButton),
		Name:    "Submit",
		TestID:  "submit",
		Actions: []protocol.Action{protocol.ActionActivate},
	}
}

// loginRouter is the application's production mouse router. Update calls
// HitTest for real Bubble Tea MouseClickMsg values; the evidence provider only
// observes the same function.
type loginRouter struct{}

func (loginRouter) HitTest(column, row int) string {
	if row == 5 && column >= 0 && column < 10 {
		return submitRecipient
	}
	return ""
}

var productionRouter loginRouter

type model struct {
	Name      textinput.Model
	Password  textinput.Model
	Submit    submitControl
	Submitted bool
}

func initialModel() model {
	name := textinput.New()
	name.Placeholder = "name"
	name.Focus()

	password := textinput.New()
	password.Placeholder = "password"
	password.EchoMode = textinput.EchoPassword

	return model{Name: name, Password: password}
}

func (m model) Init() tea.Cmd { return textinput.Blink }

func (m model) Update(message tea.Msg) (tea.Model, tea.Cmd) {
	if key, ok := message.(tea.KeyPressMsg); ok {
		switch key.String() {
		case "ctrl+c", "esc":
			return m, tea.Quit
		case "tab":
			if m.Name.Focused() {
				m.Name.Blur()
				m.Password.Focus()
			} else {
				m.Password.Blur()
				m.Name.Focus()
			}
			return m, nil
		}
	}
	if mouse, ok := message.(tea.MouseClickMsg); ok {
		point := mouse.Mouse()
		if point.Button == tea.MouseLeft && productionRouter.HitTest(point.X, point.Y) == submitRecipient {
			m.Submitted = true
			return m, nil
		}
	}

	var command tea.Cmd
	if m.Name.Focused() {
		m.Name, command = m.Name.Update(message)
	} else {
		m.Password, command = m.Password.Update(message)
	}
	return m, command
}

func (m model) View() tea.View {
	status := "waiting"
	if m.Submitted {
		status = "submitted through terminal mouse"
	}
	view := tea.NewView(fmt.Sprintf(
		"Sign in\n\n%s\n%s\n\n[ Submit ]\nstatus: %s\nTab changes field; Esc exits\n",
		m.Name.View(), m.Password.View(), status,
	))
	view.MouseMode = tea.MouseModeCellMotion
	return view
}

func main() {
	registration, err := evidence.RegisterPointerEvidenceProvider(evidence.Provider{
		ID:           "bubbletea-login-production-router",
		Version:      "1.0.0",
		Method:       "native",
		Capabilities: []string{"pointer-regions", "hit-test"},
		Observe: func(context evidence.Context) (evidence.Observation, error) {
			return evidence.Observation{
				PointerRegions: []protocol.ProviderPointerRegion{{
					RecipientID:  submitRecipient,
					RegionBounds: protocol.Rect{Row: 5, Column: 0, Width: 10, Height: 1},
					Spans:        []protocol.ProviderPointerSpan{{Row: 5, From: 0, To: 10}},
				}},
				HitTest: productionRouter.HitTest,
			}, nil
		},
	})
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	defer registration.Close()
	if _, err := tea.NewProgram(initialModel()).Run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
