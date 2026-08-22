use ratatui::buffer::Buffer;
use ratatui::layout::Rect;
use ratatui::widgets::{Paragraph, Widget};
use termwright_ratatui::{json, Action, Annotate, Role, Semantics};

struct DeploymentLabel;

impl Widget for DeploymentLabel {
    fn render(self, area: Rect, buffer: &mut Buffer) {
        Paragraph::new("Production deployment").render(area, buffer);
    }
}

struct DeployWidget;

impl Widget for DeployWidget {
    fn render(self, area: Rect, buffer: &mut Buffer) {
        Paragraph::new("Deploy ready").render(area, buffer);
    }
}

struct DeployGroup;

impl Widget for DeployGroup {
    fn render(self, area: Rect, buffer: &mut Buffer) {
        let semantics = Semantics::new()
            .semantic_key("deployment-control")
            .role(Role::Button)
            .name("Deploy")
            .description("Deploy the current release")
            .test_id("deploy-release")
            .action(Action::Activate)
            .labelled_by("deployment-label")
            .described_by("deployment-label")
            .domain("deployment", json!({"status": "ready", "attempt": 3}))
            // A hostile-looking domain key stays domain JSON. It is not
            // promoted into the node's action capability field.
            .domain("actions", json!(["click"]));
        // This deliberately bypasses Frame. Annotated itself is the exact
        // render boundary and must preserve both this call and its parent.
        DeployWidget.annotated(semantics).render(area, buffer);
    }
}

fn main() {
    let backend = ratatui::backend::TestBackend::new(40, 10);
    let mut terminal = ratatui::Terminal::new(backend).expect("terminal");
    terminal
        .draw(|frame| {
            frame.render_widget(
                DeploymentLabel.annotated(
                    Semantics::new()
                        .semantic_key("deployment-label")
                        .role(Role::Text)
                        .name("Production deployment"),
                ),
                Rect::new(3, 1, 24, 1),
            );
            let area = Rect::new(3, 2, 20, 2);
            frame.render_widget(
                DeployGroup.annotated(
                    Semantics::new()
                        .semantic_key("deployment-group")
                        .role(Role::Region)
                        .name("Deployment controls"),
                ),
                area,
            );
        })
        .expect("draw");
    println!("annotated frame rendered");
}
