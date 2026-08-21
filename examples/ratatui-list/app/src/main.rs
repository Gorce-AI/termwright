use std::io::{self, stdout};
use std::time::Duration;

use crossterm::event::{self, Event, KeyCode};
use crossterm::execute;
use crossterm::terminal::{disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen};
use ratatui::backend::CrosstermBackend;
use ratatui::widgets::{Block, Borders, List, ListItem, ListState};
use ratatui::Terminal;

fn main() -> io::Result<()> {
    enable_raw_mode()?;
    execute!(stdout(), EnterAlternateScreen)?;
    let mut terminal = Terminal::new(CrosstermBackend::new(stdout()))?;
    let result = run(&mut terminal);
    disable_raw_mode()?;
    execute!(terminal.backend_mut(), LeaveAlternateScreen)?;
    result
}

fn run(terminal: &mut Terminal<CrosstermBackend<std::io::Stdout>>) -> io::Result<()> {
    let items = ["Draft", "Ready", "Shipped"];
    let mut state = ListState::default().with_selected(Some(0));

    loop {
        terminal.draw(|frame| {
            let list = List::new(items.map(ListItem::new))
                .block(Block::default().title("Release status").borders(Borders::ALL))
                .highlight_symbol("> ");
            frame.render_stateful_widget(list, frame.area(), &mut state);
        })?;

        if !event::poll(Duration::from_millis(250))? {
            continue;
        }
        if let Event::Key(key) = event::read()? {
            match key.code {
                KeyCode::Down => state.select_next(),
                KeyCode::Up => state.select_previous(),
                KeyCode::Esc | KeyCode::Char('q') => return Ok(()),
                _ => {}
            }
        }
    }
}
