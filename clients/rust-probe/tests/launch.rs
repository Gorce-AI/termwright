//! The launcher's one promise: an instrumented build leaves the project as it
//! found it.
//!
//! A patched build rewrites `Cargo.lock` — the `ratatui-core` entry loses its
//! `source` and `checksum` and becomes a path dependency. That is a
//! modification of a file people commit, so the launcher undoes it rather than
//! relying on the user's next build to.

use std::path::PathBuf;
use std::process::Command;

use termwright_probe_ratatui::launch::{prepare_instrumented_build, PrepareOptions};

fn scratch(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("tw-launch-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).expect("scratch");
    dir
}

/// A plain Ratatui project, already resolved so its lockfile exists.
fn ratatui_project(dir: &PathBuf) -> bool {
    std::fs::create_dir_all(dir.join("src")).expect("src");
    std::fs::write(
        dir.join("Cargo.toml"),
        "[package]\nname = \"locked-app\"\nversion = \"0.1.0\"\nedition = \"2021\"\n\
         \n[dependencies]\nratatui = \"0.30\"\n",
    )
    .expect("manifest");
    std::fs::write(
        dir.join("src/main.rs"),
        "fn main() { println!(\"{}\", std::mem::size_of::<ratatui::layout::Rect>()); }\n",
    )
    .expect("source");
    Command::new(std::env::var("CARGO").unwrap_or_else(|_| "cargo".into()))
        .args(["generate-lockfile"])
        .current_dir(dir)
        .output()
        .map(|out| out.status.success())
        .unwrap_or(false)
}

fn ratatui_project_without_crossterm(dir: &PathBuf) -> bool {
    std::fs::create_dir_all(dir.join("src")).expect("src");
    std::fs::write(
        dir.join("Cargo.toml"),
        "[package]\nname = \"backend-neutral-app\"\nversion = \"0.1.0\"\nedition = \"2021\"\n\
         \n[dependencies]\nratatui = { version = \"=0.30.2\", default-features = false, features = [\"std\"] }\n\
         ratatui-core = \"=0.1.2\"\nratatui-widgets = \"=0.3.2\"\n",
    )
    .expect("manifest");
    std::fs::write(
        dir.join("src/main.rs"),
        r#"fn main() {
    let backend = ratatui::backend::TestBackend::new(20, 5);
    let mut terminal = ratatui::Terminal::new(backend).expect("terminal");
    terminal.draw(|frame| {
        frame.render_widget(ratatui::widgets::Paragraph::new("visual-ok"), frame.area());
    }).expect("visual draw");
    println!("visual-ok");
}
"#,
    )
    .expect("source");
    Command::new(std::env::var("CARGO").unwrap_or_else(|_| "cargo".into()))
        .args(["generate-lockfile"])
        .current_dir(dir)
        .output()
        .map(|out| out.status.success())
        .unwrap_or(false)
}

fn start_driver(path: &str) -> std::sync::mpsc::Receiver<serde_json::Value> {
    use std::io::{Read, Write};
    use std::os::unix::net::UnixListener;

    use termwright_protocol::{encode_frame, FrameDecoder, DEFAULT_LIMITS};

    let listener = UnixListener::bind(path).expect("binding the driver socket");
    let (sender, receiver) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let Ok((mut stream, _)) = listener.accept() else {
            return;
        };
        let mut decoder =
            FrameDecoder::new(DEFAULT_LIMITS.max_frame_bytes, DEFAULT_LIMITS.max_depth);
        let mut buffer = [0u8; 16384];
        loop {
            let Ok(count) = stream.read(&mut buffer) else {
                return;
            };
            if count == 0 {
                return;
            }
            let Ok(frames) = decoder.push(&buffer[..count]) else {
                return;
            };
            for frame in frames {
                if frame.value.get("type").and_then(serde_json::Value::as_str) == Some("hello") {
                    let ack = serde_json::json!({
                        "type": "hello-ack",
                        "protocol": "termwright/3",
                        "sessionId": "s-no-crossterm",
                        "limits": DEFAULT_LIMITS,
                        "subscribe": "semantic",
                        "marker": { "enabled": true },
                    });
                    let encoded =
                        encode_frame(&ack, DEFAULT_LIMITS.max_frame_bytes).expect("encoding");
                    let _ = stream.write_all(&encoded);
                }
                if sender.send(frame.value).is_err() {
                    return;
                }
            }
        }
    });
    receiver
}

#[test]
fn an_instrumented_build_leaves_cargo_lock_byte_identical() {
    let project = scratch("project");
    if !ratatui_project(&project) {
        assert_ne!(
            std::env::var("TERMWRIGHT_REQUIRE_RATATUI").as_deref(),
            Ok("1"),
            "CI requires the Ratatui launcher fixture to resolve; skipping would certify nothing"
        );
        eprintln!("skipped: could not resolve a Ratatui project (offline?)");
        return;
    }
    let lock = project.join("Cargo.lock");
    let before = std::fs::read(&lock).expect("a lockfile");

    let workspace = scratch("workspace");
    let options = PrepareOptions {
        project: project.clone(),
        workspace: Some(workspace.clone()),
        probe: Some(PathBuf::from(env!("CARGO_MANIFEST_DIR"))),
    };
    // Resolving the pristine fixture above is the only network precondition.
    // Once that succeeded, every prepare failure is a launcher regression and
    // must fail this test rather than masquerading as an offline skip.
    let prepared = prepare_instrumented_build(&options).expect("prepare instrumented build");

    // Core captures the tree, widgets exposes state, and Crossterm owns the
    // certified same-writer marker sink.
    assert_eq!(prepared.config_args.len(), 3, "{:?}", prepared.config_args);
    assert!(prepared
        .config_args
        .iter()
        .any(|arg| arg.contains("ratatui-core")));
    assert!(prepared
        .config_args
        .iter()
        .any(|arg| arg.contains("ratatui-widgets")));
    assert!(prepared
        .config_args
        .iter()
        .any(|arg| arg.contains("ratatui-crossterm")));
    assert!(
        prepared
            .env
            .iter()
            .any(|(key, value)| { key == "TERMWRIGHT_RATATUI_VERSION" && value == "0.30.2" }),
        "the handshake must report the public ratatui package version: {:?}",
        prepared.env
    );
    assert!(prepared.built, "a fresh cache was reported as reused");
    let first_copies = prepared.copies.clone();

    let mut command = Command::new(std::env::var("CARGO").unwrap_or_else(|_| "cargo".into()));
    command.args(["build", "--quiet"]).current_dir(&project);
    for arg in &prepared.config_args {
        command.arg("--config").arg(arg);
    }
    for (key, value) in &prepared.env {
        command.env(key, value);
    }
    let built = command.output().expect("cargo runs");
    assert!(
        built.status.success(),
        "the instrumented build failed:\n{}",
        String::from_utf8_lossy(&built.stderr)
    );

    // The build rewrote it; this is the assertion that matters.
    let during = std::fs::read(&lock).expect("a lockfile");
    assert_ne!(
        during, before,
        "the patched build did not rewrite Cargo.lock, so this test is no longer \
         exercising the thing it exists for"
    );

    prepared.finish().expect("restore");
    let after = std::fs::read(&lock).expect("a lockfile");
    assert_eq!(
        after, before,
        "the project's Cargo.lock was left modified by an instrumented build"
    );

    let cached = prepare_instrumented_build(&options).expect("reuse the instrumented copies");
    assert!(
        !cached.built,
        "the second preparation rebuilt a complete cache entry"
    );
    assert_eq!(cached.copies, first_copies);
    cached.finish().expect("restore after cache hit");

    let _ = std::fs::remove_dir_all(&project);
    let _ = std::fs::remove_dir_all(&workspace);
}

#[test]
fn a_project_without_crossterm_builds_with_two_patches_and_fails_semantics_closed() {
    use std::time::{Duration, Instant};

    let project = scratch("without-crossterm");
    if !ratatui_project_without_crossterm(&project) {
        assert_ne!(
            std::env::var("TERMWRIGHT_REQUIRE_RATATUI").as_deref(),
            Ok("1"),
            "CI requires the backend-neutral Ratatui fixture to resolve"
        );
        eprintln!("skipped: could not resolve backend-neutral Ratatui project");
        return;
    }
    let workspace = scratch("without-crossterm-workspace");
    let prepared = prepare_instrumented_build(&PrepareOptions {
        project: project.clone(),
        workspace: Some(workspace.clone()),
        probe: Some(PathBuf::from(env!("CARGO_MANIFEST_DIR"))),
    })
    .expect("prepare backend-neutral build");
    assert_eq!(prepared.config_args.len(), 2, "{:?}", prepared.config_args);
    assert!(prepared
        .config_args
        .iter()
        .any(|arg| arg.contains("ratatui-core")));
    assert!(prepared
        .config_args
        .iter()
        .any(|arg| arg.contains("ratatui-widgets")));
    assert!(!prepared
        .config_args
        .iter()
        .any(|arg| arg.contains("ratatui-crossterm")));

    let socket = format!("/tmp/tw-ratatui-no-crossterm-{}.sock", std::process::id());
    let _ = std::fs::remove_file(&socket);
    let received = start_driver(&socket);
    let mut command = Command::new(std::env::var("CARGO").unwrap_or_else(|_| "cargo".into()));
    command.args(["run", "--quiet"]).current_dir(&project);
    for config in &prepared.config_args {
        command.arg("--config").arg(config);
    }
    for (key, value) in &prepared.env {
        command.env(key, value);
    }
    let run = command
        .env("TERMWRIGHT_ENDPOINT", &socket)
        .env("TERMWRIGHT_TOKEN", "test-token")
        .output()
        .expect("backend-neutral cargo run");
    prepared.finish().expect("restore lock");
    assert!(
        run.status.success(),
        "backend-neutral app did not build/run:\n{}",
        String::from_utf8_lossy(&run.stderr)
    );
    assert!(String::from_utf8_lossy(&run.stdout).contains("visual-ok"));

    let deadline = Instant::now() + Duration::from_secs(10);
    let mut snapshot = None;
    let mut fatal = None;
    while Instant::now() < deadline && fatal.is_none() {
        match received.recv_timeout(Duration::from_millis(200)) {
            Ok(message) if message["type"] == "snapshot" => snapshot = Some(message),
            Ok(message) if message["type"] == "error" => fatal = Some(message),
            Ok(_) => {}
            Err(_) => break,
        }
    }
    assert!(
        snapshot.is_none(),
        "unsupported backend published: {snapshot:?}"
    );
    let fatal = fatal.expect("unsupported backend did not fail semantics");
    assert_eq!(fatal["code"], "adapter-guarantee-violation");
    assert!(fatal["message"]
        .as_str()
        .is_some_and(|message| message.contains("no certified render-commit marker sink")));
    assert!(
        !run.stdout
            .windows(b"\x1b]8487;".len())
            .any(|window| window == b"\x1b]8487;"),
        "backend-neutral app leaked a false stdout marker"
    );

    let _ = std::fs::remove_file(&socket);
    let _ = std::fs::remove_dir_all(&project);
    let _ = std::fs::remove_dir_all(&workspace);
}

/// A project that does not use Ratatui gets told so, by name.
#[test]
fn a_project_without_ratatui_is_refused_clearly() {
    let project = scratch("not-ratatui");
    std::fs::create_dir_all(project.join("src")).expect("src");
    std::fs::write(
        project.join("Cargo.toml"),
        "[package]\nname = \"plain\"\nversion = \"0.1.0\"\nedition = \"2021\"\n",
    )
    .expect("manifest");
    std::fs::write(project.join("src/main.rs"), "fn main() {}\n").expect("source");

    let mut options = PrepareOptions::new(project.clone());
    options.workspace = Some(scratch("unused"));
    let error =
        prepare_instrumented_build(&options).expect_err("a non-Ratatui project must be refused");
    let message = error.to_string();
    assert!(
        message.contains("ratatui-core"),
        "the refusal does not name what is missing: {message}"
    );
    let _ = std::fs::remove_dir_all(&project);
}
