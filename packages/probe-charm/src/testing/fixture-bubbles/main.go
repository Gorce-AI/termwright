// A plain Bubble Tea v2 application using two Bubbles components whose state
// is otherwise invisible from outside the library: a spinner, which has no
// public frame index, and a progress bar, whose Percent() reports the target
// of its animation rather than what is drawn.
//
// Imports nothing of termwright's.
package main

import (
	"fmt"
	"os"
	"time"

	"charm.land/bubbles/v2/progress"
	"charm.land/bubbles/v2/spinner"
	tea "charm.land/bubbletea/v2"
)

type tickMsg time.Time

type model struct {
	Spinner  spinner.Model
	Progress progress.Model
	Ready    bool
}

func initialModel() model {
	s := spinner.New()
	s.Spinner = spinner.Dot
	return model{Spinner: s, Progress: progress.New(progress.WithoutPercentage())}
}

func (m model) Init() tea.Cmd {
	return tea.Batch(m.Spinner.Tick, tick())
}

func tick() tea.Cmd {
	return tea.Tick(40*time.Millisecond, func(t time.Time) tea.Msg { return tickMsg(t) })
}

func (m model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch message := msg.(type) {
	case tea.KeyPressMsg:
		if message.String() == "ctrl+c" || message.String() == "q" {
			return m, tea.Quit
		}
	case tickMsg:
		if !m.Ready {
			m.Ready = true
			// A target the animation walks towards, so the drawn fraction and
			// the target differ for a while and then converge.
			return m, tea.Batch(tick(), m.Progress.SetPercent(0.42))
		}
		return m, tick()
	}

	var commands []tea.Cmd
	updatedSpinner, spinnerCommand := m.Spinner.Update(msg)
	m.Spinner = updatedSpinner
	commands = append(commands, spinnerCommand)

	updatedProgress, progressCommand := m.Progress.Update(msg)
	m.Progress = updatedProgress
	commands = append(commands, progressCommand)

	return m, tea.Batch(commands...)
}

func (m model) View() tea.View {
	return tea.NewView(fmt.Sprintf("Loading %s\n\n%s\n\nq to quit\n",
		m.Spinner.View(), m.Progress.View()))
}

func main() {
	if _, err := tea.NewProgram(initialModel()).Run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
