use std::io::{self, stdout};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use crossterm::event::{
    self, DisableMouseCapture, EnableMouseCapture, Event, KeyCode, MouseButton, MouseEvent,
    MouseEventKind,
};
use crossterm::execute;
use crossterm::terminal::{
    disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen,
};
use ratatui::backend::CrosstermBackend;
use ratatui::layout::Rect;
use ratatui::widgets::{Block, Borders, List, ListItem, ListState};
use ratatui::Terminal;
use termwright_ratatui::{
    register_pointer_evidence_provider, Annotate, EvidenceContext, EvidenceMethod,
    PointerEvidenceObservation, PointerEvidenceProvider, ProviderPointerRegion,
    ProviderPointerSpan, ProviderRect, Role, Semantics,
};

const LIST_RECIPIENT: &str = "k:release-list";

/// The application's production router is shared by normal input handling and
/// Termwright's read-only evidence provider. Termwright never calls `select`.
#[derive(Debug, Default)]
struct PointerRouter {
    list_rect: Mutex<Option<Rect>>,
}

impl PointerRouter {
    fn update_list_rect(&self, rect: Rect) {
        *self.list_rect.lock().expect("pointer router poisoned") = Some(rect);
    }

    fn hit_test(&self, column: u16, row: u16) -> Option<&'static str> {
        let rect = self
            .list_rect
            .lock()
            .expect("pointer router poisoned")
            .as_ref()
            .copied()?;
        let inside = column >= rect.x
            && column < rect.x.saturating_add(rect.width)
            && row >= rect.y
            && row < rect.y.saturating_add(rect.height);
        inside.then_some(LIST_RECIPIENT)
    }

    fn selected_index(&self, event: MouseEvent, item_count: usize) -> Option<usize> {
        if event.kind != MouseEventKind::Down(MouseButton::Left)
            || self.hit_test(event.column, event.row).is_none()
        {
            return None;
        }
        let rect = self
            .list_rect
            .lock()
            .expect("pointer router poisoned")
            .as_ref()
            .copied()?;
        let index = event.row.checked_sub(rect.y.saturating_add(1))? as usize;
        (index < item_count).then_some(index)
    }
}

impl PointerEvidenceProvider for PointerRouter {
    fn id(&self) -> &str {
        "ratatui-list-production-router"
    }
    fn version(&self) -> &str {
        "1"
    }
    fn method(&self) -> EvidenceMethod {
        EvidenceMethod::Native
    }
    fn capabilities(&self) -> Vec<String> {
        vec!["pointer-regions".into(), "hit-test".into()]
    }
    fn observe(&self, context: &EvidenceContext) -> Result<PointerEvidenceObservation, String> {
        let rect = self
            .list_rect
            .lock()
            .map_err(|_| "pointer router poisoned")?
            .as_ref()
            .copied()
            .ok_or("list has not rendered")?;
        let top = i64::from(rect.y).clamp(0, context.rows);
        let bottom = i64::from(rect.y.saturating_add(rect.height)).clamp(top, context.rows);
        let left = i64::from(rect.x).clamp(0, context.columns);
        let right = i64::from(rect.x.saturating_add(rect.width)).clamp(left, context.columns);
        let spans = (top..bottom)
            .map(|row| ProviderPointerSpan {
                row,
                from: left,
                to: right,
            })
            .collect();
        let router = Arc::new(
            self.list_rect
                .lock()
                .map_err(|_| "pointer router poisoned")?
                .clone(),
        );
        Ok(PointerEvidenceObservation {
            pointer_regions: vec![ProviderPointerRegion {
                recipient_id: LIST_RECIPIENT.into(),
                region_bounds: ProviderRect::new(top, left, right - left, bottom - top),
                spans,
            }],
            hit_test: Some(Arc::new(move |column, row| {
                let rect = router.as_ref().as_ref()?;
                let inside = column >= i64::from(rect.x)
                    && column < i64::from(rect.x.saturating_add(rect.width))
                    && row >= i64::from(rect.y)
                    && row < i64::from(rect.y.saturating_add(rect.height));
                inside.then(|| LIST_RECIPIENT.into())
            })),
        })
    }
}

fn main() -> io::Result<()> {
    let router = Arc::new(PointerRouter::default());
    let _evidence = register_pointer_evidence_provider(router.clone()).map_err(io::Error::other)?;
    enable_raw_mode()?;
    execute!(stdout(), EnterAlternateScreen, EnableMouseCapture)?;
    let mut terminal = Terminal::new(CrosstermBackend::new(stdout()))?;
    let result = run(&mut terminal, router);
    disable_raw_mode()?;
    execute!(
        terminal.backend_mut(),
        DisableMouseCapture,
        LeaveAlternateScreen
    )?;
    result
}

fn run(
    terminal: &mut Terminal<CrosstermBackend<std::io::Stdout>>,
    router: Arc<PointerRouter>,
) -> io::Result<()> {
    let items = ["Draft", "Ready", "Shipped"];
    let mut state = ListState::default().with_selected(Some(0));

    loop {
        terminal.draw(|frame| {
            router.update_list_rect(frame.area());
            let list = List::new(items.map(ListItem::new))
                .block(
                    Block::default()
                        .title("Release status")
                        .borders(Borders::ALL),
                )
                .highlight_symbol("> ")
                .annotated(
                    Semantics::new()
                        .role(Role::List)
                        .name("Release status")
                        .semantic_key("release-list"),
                );
            frame.render_stateful_widget(list, frame.area(), &mut state);
        })?;

        if !event::poll(Duration::from_millis(250))? {
            continue;
        }
        match event::read()? {
            Event::Key(key) => match key.code {
                KeyCode::Down => state.select_next(),
                KeyCode::Up => state.select_previous(),
                KeyCode::Esc | KeyCode::Char('q') => return Ok(()),
                _ => {}
            },
            Event::Mouse(mouse) => {
                if let Some(index) = router.selected_index(mouse, items.len()) {
                    state.select(Some(index));
                }
            }
            _ => {}
        }
    }
}
