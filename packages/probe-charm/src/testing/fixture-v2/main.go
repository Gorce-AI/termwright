// A plain Bubble Tea v2 application. It imports nothing of termwright's and
// has no flag or build tag: this is the "zero config" the probe works against.
package main

import (
	"fmt"
	"os"

	tea "charm.land/bubbletea/v2"
	"charm.land/bubbles/v2/textinput"
)

type model struct {
	// Exported, because the probe walks the user's model and deliberately
	// refuses to read unexported fields of someone else's struct.
	Name     textinput.Model
	Password textinput.Model
	Status   string
	KeyCount int
}

func initialModel() model {
	name := textinput.New()
	name.Placeholder = "name"
	name.Focus()

	secret := textinput.New()
	secret.Placeholder = "password"
	secret.EchoMode = textinput.EchoPassword

	return model{Name: name, Password: secret, Status: "ready"}
}

func (m model) Init() tea.Cmd { return textinput.Blink }

func (m model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch message := msg.(type) {
	case tea.KeyPressMsg:
		switch message.String() {
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
		m.KeyCount += len([]rune(message.String()))
		m.Status = fmt.Sprintf("batch-complete:%d", m.KeyCount)
	}

	var command tea.Cmd
	if m.Name.Focused() {
		m.Name, command = m.Name.Update(msg)
	} else {
		m.Password, command = m.Password.Update(msg)
	}
	return m, command
}

func (m model) View() tea.View {
	return tea.NewView(fmt.Sprintf(
		"Sign in\n\n%s\n%s\n\nstatus: %s\n",
		m.Name.View(), m.Password.View(), m.Status,
	))
}

func main() {
	if _, err := tea.NewProgram(initialModel()).Run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
