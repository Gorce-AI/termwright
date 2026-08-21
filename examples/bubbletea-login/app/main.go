package main

import (
	"fmt"
	"os"

	"charm.land/bubbles/v2/textinput"
	tea "charm.land/bubbletea/v2"
)

type model struct {
	Name     textinput.Model
	Password textinput.Model
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

	var command tea.Cmd
	if m.Name.Focused() {
		m.Name, command = m.Name.Update(message)
	} else {
		m.Password, command = m.Password.Update(message)
	}
	return m, command
}

func (m model) View() tea.View {
	return tea.NewView(fmt.Sprintf(
		"Sign in\n\n%s\n%s\n\nTab changes field; Esc exits\n",
		m.Name.View(), m.Password.View(),
	))
}

func main() {
	if _, err := tea.NewProgram(initialModel()).Run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
