package main

import tea "github.com/charmbracelet/bubbletea"

type model struct {
	status string
}

func (model) Init() tea.Cmd { return nil }

func (m model) Update(message tea.Msg) (tea.Model, tea.Cmd) {
	if key, ok := message.(tea.KeyMsg); ok && key.String() == "x" {
		m.status = "changed"
	}
	return m, nil
}

func (m model) View() string { return m.status + "\n" }

func main() {
	if _, err := tea.NewProgram(model{status: "ready"}).Run(); err != nil {
		panic(err)
	}
}
