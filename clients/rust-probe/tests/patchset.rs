//! Applying the patch set to a real `ratatui-core` from the registry.
//!
//! These are the tests that would have caught every mistake worth making here:
//! a patch that no longer matches the version it was written for, a copy that
//! applied cleanly and produced something else, a `no_std` build broken by
//! instrumentation nobody asked for, and — the one that matters most — a
//! patched crate that resolves but never runs.
//!
//! They need the crate unpacked in the local registry and `cargo` on the path.
//! Where either is missing the test says so and skips, rather than passing
//! while proving nothing.

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use termwright_probe_ratatui::launch::{prepare_instrumented_build, PrepareOptions};
use termwright_probe_ratatui::patchset::{apply, copy_out, digest_file, read_manifest};

fn core_version() -> String {
    std::env::var("TERMWRIGHT_CANDIDATE_RATATUI_CORE").unwrap_or_else(|_| "0.1.2".into())
}

fn widgets_version() -> String {
    std::env::var("TERMWRIGHT_CANDIDATE_RATATUI_WIDGETS").unwrap_or_else(|_| "0.3.2".into())
}

fn crossterm_version() -> String {
    std::env::var("TERMWRIGHT_CANDIDATE_RATATUI_CROSSTERM").unwrap_or_else(|_| "0.1.2".into())
}

fn framework_version() -> String {
    std::env::var("TERMWRIGHT_CANDIDATE_RATATUI").unwrap_or_else(|_| "0.30.2".into())
}

fn app_dependencies() -> String {
    format!(
        "ratatui = \"={}\"\nratatui-core = \"={}\"\nratatui-widgets = \"={}\"\nratatui-crossterm = \"={}\"\n",
        framework_version(),
        core_version(),
        widgets_version(),
        crossterm_version()
    )
}

fn patch_set_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("upstream-patches/ratatui-core")
        .join(core_version())
}

fn widgets_patch_set_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("upstream-patches/ratatui-widgets")
        .join(widgets_version())
}

fn crossterm_patch_set_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("upstream-patches/ratatui-crossterm")
        .join(crossterm_version())
}

fn probe_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

/// The unpacked crate in the local registry, if it is there.
///
/// Returns `None` rather than failing: a machine that has never built anything
/// depending on Ratatui has nothing to patch, and that is not a defect in the
/// patch set.
fn registry_source() -> Option<PathBuf> {
    unpacked(&format!("ratatui-core-{}", core_version()))
}

fn widgets_source() -> Option<PathBuf> {
    unpacked(&format!("ratatui-widgets-{}", widgets_version()))
}

fn crossterm_source() -> Option<PathBuf> {
    unpacked(&format!("ratatui-crossterm-{}", crossterm_version()))
}

fn unpacked(name: &str) -> Option<PathBuf> {
    let home = std::env::var_os("CARGO_HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".cargo")))?;
    for entry in std::fs::read_dir(home.join("registry/src")).ok()? {
        let candidate = entry.ok()?.path().join(name);
        if candidate.is_dir() {
            return Some(candidate);
        }
    }
    None
}

fn scratch(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("tw-patchset-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    dir
}

fn require_candidate_source(message: &str) {
    assert_ne!(
        std::env::var("TERMWRIGHT_REQUIRE_RATATUI").as_deref(),
        Ok("1"),
        "{message}"
    );
}

fn cargo(args: &[&str], dir: &Path) -> std::process::Output {
    Command::new(std::env::var("CARGO").unwrap_or_else(|_| "cargo".into()))
        .args(args)
        .current_dir(dir)
        .output()
        .expect("cargo runs")
}

// -- the patch set itself ---------------------------------------------------

/// The pinned "before" checksums must match what the registry actually holds.
///
/// This is the test that fails the day Ratatui publishes a new 0.1.x, and it
/// fails saying *what the file is* rather than pointing at a line inside a
/// rejected hunk.
#[test]
fn the_manifest_pins_the_version_on_disk() {
    let Some(source) = registry_source() else {
        require_candidate_source("CI requires the Ratatui core candidate source");
        eprintln!(
            "skipped: ratatui-core {} is not unpacked in this registry",
            core_version()
        );
        return;
    };
    let manifest = read_manifest(&patch_set_dir().join("manifest.json")).expect("manifest");
    for file in &manifest.patched {
        let on_disk = digest_file(&source.join(&file.path)).expect("digest");
        assert_eq!(
            on_disk, file.sha256_before,
            "{} in the registry is not what the patch set was written for",
            file.path
        );
    }
}

#[test]
fn applying_it_produces_exactly_the_pinned_result() {
    let Some(source) = registry_source() else {
        require_candidate_source("CI requires the Ratatui core candidate source");
        eprintln!(
            "skipped: ratatui-core {} is not unpacked in this registry",
            core_version()
        );
        return;
    };
    let copy = scratch("apply");
    copy_out(&source, &copy).expect("copy out");
    let manifest = read_manifest(&patch_set_dir().join("manifest.json")).expect("manifest");

    apply(&manifest, &patch_set_dir(), &copy, &probe_dir()).expect("the patch set applies");

    // `apply` checks the after-state itself; this asserts the part it cannot:
    // the machine-specific path was written in afterwards.
    let text = std::fs::read_to_string(copy.join("Cargo.toml")).expect("readable");
    assert!(
        text.contains(&format!("path = \"{}\"", probe_dir().display())),
        "the probe path was never supplied"
    );
    let init = std::fs::read_to_string(copy.join("src/terminal/init.rs")).expect("init source");
    assert!(
        init.contains("termwright_probe_ratatui::session::initialize();"),
        "the startup handshake was not installed before the render loop"
    );
    let render =
        std::fs::read_to_string(copy.join("src/terminal/render.rs")).expect("render source");
    assert!(
        !render.contains("session::initialize()"),
        "the blocking handshake leaked into the render hook"
    );
    let _ = std::fs::remove_dir_all(&copy);
}

#[test]
fn crossterm_same_sink_patch_is_exact_and_has_no_probe_dependency() {
    let Some(source) = crossterm_source() else {
        require_candidate_source("CI requires the Ratatui Crossterm candidate source");
        eprintln!(
            "skipped: ratatui-crossterm {} is not unpacked",
            crossterm_version()
        );
        return;
    };
    let manifest =
        read_manifest(&crossterm_patch_set_dir().join("manifest.json")).expect("manifest");
    for file in &manifest.patched {
        assert_eq!(
            digest_file(&source.join(&file.path)).expect("digest"),
            file.sha256_before,
            "{} is not the pinned Crossterm source",
            file.path
        );
    }
    let copy = scratch("crossterm-apply");
    copy_out(&source, &copy).expect("copy out");
    apply(&manifest, &crossterm_patch_set_dir(), &copy, &probe_dir())
        .expect("same-sink patch applies");
    assert!(
        !std::fs::read_to_string(copy.join("Cargo.toml"))
            .expect("manifest text")
            .contains("termwright-probe-ratatui"),
        "Crossterm should implement the core trait without a direct probe dependency"
    );
    let _ = std::fs::remove_dir_all(copy);
}

/// A copy that is not the pinned version is refused before anything is edited.
#[test]
fn a_version_mismatch_is_refused_by_name() {
    let Some(source) = registry_source() else {
        require_candidate_source("CI requires the Ratatui core candidate source");
        eprintln!(
            "skipped: ratatui-core {} is not unpacked in this registry",
            core_version()
        );
        return;
    };
    let copy = scratch("mismatch");
    copy_out(&source, &copy).expect("copy out");
    let target = copy.join("src/terminal/frame.rs");
    let mut text = std::fs::read_to_string(&target).expect("readable");
    text.push_str("\n// something a future release might add\n");
    std::fs::write(&target, text).expect("writable");

    let manifest = read_manifest(&patch_set_dir().join("manifest.json")).expect("manifest");
    let error = apply(&manifest, &patch_set_dir(), &copy, &probe_dir())
        .expect_err("a changed file must be refused");
    let message = error.to_string();
    assert!(
        message.contains("src/terminal/frame.rs"),
        "the error does not say which file: {message}"
    );
    assert!(
        message.contains("not the file this patch set was written for"),
        "{message}"
    );
    let _ = std::fs::remove_dir_all(&copy);
}

// -- what the patched copy does ---------------------------------------------

/// The constraint that shapes the whole design: a `no_std` user must be able to
/// build the patched crate, and must not pull the probe in at all.
#[test]
fn the_patched_copy_still_builds_without_std() {
    let Some(source) = registry_source() else {
        require_candidate_source("CI requires the Ratatui core candidate source");
        eprintln!(
            "skipped: ratatui-core {} is not unpacked in this registry",
            core_version()
        );
        return;
    };
    let copy = scratch("nostd");
    copy_out(&source, &copy).expect("copy out");
    let manifest = read_manifest(&patch_set_dir().join("manifest.json")).expect("manifest");
    apply(&manifest, &patch_set_dir(), &copy, &probe_dir()).expect("applies");

    let built = cargo(&["build", "--quiet", "--no-default-features"], &copy);
    assert!(
        built.status.success(),
        "a no_std build of the patched crate failed:\n{}",
        String::from_utf8_lossy(&built.stderr)
    );

    let tree = cargo(&["tree", "--no-default-features"], &copy);
    let text = String::from_utf8_lossy(&tree.stdout);
    assert!(
        !text.contains("termwright-probe-ratatui"),
        "a no_std build pulled the probe in:\n{text}"
    );

    let with_std = cargo(&["build", "--quiet", "--features", "std"], &copy);
    assert!(
        with_std.status.success(),
        "a std build of the patched crate failed:\n{}",
        String::from_utf8_lossy(&with_std.stderr)
    );
    let _ = std::fs::remove_dir_all(&copy);
}

/// The same constraint for the second crate. `ratatui-widgets` is `#![no_std]`
/// too, and a probe that broke an embedded build would be doing more harm than
/// the semantics are worth.
#[test]
fn the_patched_widgets_still_build_without_std() {
    let Some(source) = widgets_source() else {
        require_candidate_source("CI requires the Ratatui widgets candidate source");
        eprintln!(
            "skipped: ratatui-widgets {} is not unpacked in this registry",
            widgets_version()
        );
        return;
    };
    let copy = scratch("widgets-nostd");
    copy_out(&source, &copy).expect("copy out");
    let manifest = read_manifest(&widgets_patch_set_dir().join("manifest.json")).expect("manifest");
    apply(&manifest, &widgets_patch_set_dir(), &copy, &probe_dir()).expect("applies");

    let built = cargo(&["build", "--quiet", "--no-default-features"], &copy);
    assert!(
        built.status.success(),
        "a no_std build of the patched widgets failed:\n{}",
        String::from_utf8_lossy(&built.stderr)
    );
    let tree = cargo(&["tree", "--no-default-features"], &copy);
    assert!(
        !String::from_utf8_lossy(&tree.stdout).contains("termwright-probe-ratatui"),
        "a no_std build pulled the probe in"
    );
    let _ = std::fs::remove_dir_all(&copy);
}

// -- end to end, on an application that imports nothing of ours -------------

/// The claim the whole phase rests on: a plain Ratatui application, built with
/// nothing but a `--config` flag, runs our code.
///
/// The earlier tests prove the copy compiles and that the graph points at it.
/// Neither proves it *executes*, and those are different claims — a patch that
/// resolves and never runs would pass every check above.
#[test]
fn a_vanilla_ratatui_app_reaches_the_probe() {
    let Some(source) = registry_source() else {
        require_candidate_source("CI requires the Ratatui core candidate source");
        eprintln!(
            "skipped: ratatui-core {} is not unpacked in this registry",
            core_version()
        );
        return;
    };
    let copy = scratch("e2e-core");
    copy_out(&source, &copy).expect("copy out");
    let manifest = read_manifest(&patch_set_dir().join("manifest.json")).expect("manifest");
    apply(&manifest, &patch_set_dir(), &copy, &probe_dir()).expect("applies");

    // An ordinary application: it depends on ratatui and on nothing of ours.
    let app = scratch("e2e-app");
    std::fs::create_dir_all(app.join("src")).expect("app dir");
    std::fs::write(
        app.join("Cargo.toml"),
        format!("[package]\nname = \"vanilla-app\"\nversion = \"0.1.0\"\nedition = \"2021\"\n\n[dependencies]\n{}", app_dependencies()),
    )
    .expect("manifest");
    std::fs::write(
        app.join("src/main.rs"),
        r#"fn main() {
    let backend = ratatui::backend::TestBackend::new(20, 5);
    let mut terminal = ratatui::Terminal::new(backend).expect("terminal");
    terminal
        .draw(|frame| {
            frame.render_widget(ratatui::widgets::Paragraph::new("hello"), frame.area());
        })
        .expect("draw");
    let screen: String = terminal
        .backend()
        .buffer()
        .content()
        .iter()
        .map(|cell| cell.symbol())
        .collect();
    println!("screen={screen:?}");
    println!("drew a frame");
}
"#,
    )
    .expect("source");

    let log = app.join("probe.log");
    let patch = format!("patch.crates-io.ratatui-core.path='{}'", copy.display());
    let run = Command::new(std::env::var("CARGO").unwrap_or_else(|_| "cargo".into()))
        .args(["run", "--quiet", "--config", &patch])
        .current_dir(&app)
        .env("TERMWRIGHT_ENDPOINT", app.join("endpoint.sock"))
        .env("TERMWRIGHT_TOKEN", "test-token")
        .env("TERMWRIGHT_DEBUG_FILE", &log)
        .output()
        .expect("cargo runs");
    assert!(
        run.status.success(),
        "the instrumented app failed:\n{}",
        String::from_utf8_lossy(&run.stderr)
    );
    assert!(
        String::from_utf8_lossy(&run.stdout).contains("drew a frame"),
        "the application did not run its own code"
    );

    let text = std::fs::read_to_string(&log).expect("the probe wrote no diagnostics at all");
    assert!(
        text.contains("no session, publishing nothing"),
        "the patched Terminal constructor never initialized the probe:\n{text}"
    );
    assert!(
        !text.contains("first render intercepted") && !text.contains("Paragraph"),
        "the render path performed synchronous diagnostic I/O:\n{text}"
    );

    // And the same application, uninstrumented, publishes nothing. It does say
    // why, once, because a typo in one of the two variables is otherwise
    // indistinguishable from a probe that does not work.
    let dormant_log = app.join("dormant.log");
    let dormant = Command::new(std::env::var("CARGO").unwrap_or_else(|_| "cargo".into()))
        .args(["run", "--quiet", "--config", &patch])
        .current_dir(&app)
        .env_remove("TERMWRIGHT_ENDPOINT")
        .env_remove("TERMWRIGHT_TOKEN")
        .env("TERMWRIGHT_DEBUG_FILE", &dormant_log)
        .output()
        .expect("cargo runs");
    assert!(dormant.status.success());
    let dormant_text = std::fs::read_to_string(&dormant_log).unwrap_or_default();
    assert!(
        !dormant_text.contains("first render intercepted"),
        "a dormant run collected render calls:\n{dormant_text}"
    );
    assert!(
        !dormant_text.contains("session started"),
        "a dormant run opened a session:\n{dormant_text}"
    );
    assert!(
        dormant_text.contains("dormant:"),
        "a dormant run did not say why it published nothing:\n{dormant_text}"
    );

    // I1 non-interference golden: the patched crate with an inactive probe
    // must leave both application output and the framework's complete
    // TestBackend buffer byte-identical to an ordinary upstream build.
    let upstream = Command::new(std::env::var("CARGO").unwrap_or_else(|_| "cargo".into()))
        .args(["run", "--quiet"])
        .current_dir(&app)
        .env_remove("TERMWRIGHT_ENDPOINT")
        .env_remove("TERMWRIGHT_TOKEN")
        .env_remove("TERMWRIGHT_DEBUG_FILE")
        .output()
        .expect("upstream cargo runs");
    assert!(
        upstream.status.success(),
        "the upstream golden app failed:\n{}",
        String::from_utf8_lossy(&upstream.stderr)
    );
    assert_eq!(
        dormant.stdout, upstream.stdout,
        "dormant instrumentation changed terminal output or TestBackend state"
    );

    let _ = std::fs::remove_dir_all(&copy);
    let _ = std::fs::remove_dir_all(&app);
}

// -- the definition of done for this framework ------------------------------

/// A driver end that completes the handshake and records what arrives.
fn start_driver(path: &str) -> std::sync::mpsc::Receiver<serde_json::Value> {
    start_driver_sessions(path, 1)
}

/// A driver that accepts an exact number of sequential semantic sessions.
/// EOF from each completed Terminal lifecycle is the only restart barrier.
fn start_driver_sessions(
    path: &str,
    sessions: usize,
) -> std::sync::mpsc::Receiver<serde_json::Value> {
    use std::io::{Read, Write};
    use std::os::unix::net::UnixListener;

    use termwright_protocol::{encode_frame, FrameDecoder, DEFAULT_LIMITS};

    let listener = UnixListener::bind(path).expect("binding the driver socket");
    let (sender, receiver) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        for epoch in 1..=sessions {
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
                    break;
                }
                let Ok(frames) = decoder.push(&buffer[..count]) else {
                    return;
                };
                for frame in frames {
                    if frame.value.get("type").and_then(serde_json::Value::as_str) == Some("hello")
                    {
                        let ack = serde_json::json!({
                            "type": "hello-ack",
                            "protocol": "termwright/3",
                            "sessionId": format!("s-e2e-{epoch}"),
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
        }
    });
    receiver
}

/// TestBackend renders into memory, not process stdout. It must fail the
/// semantic capability before publishing rather than fabricate a commit on an
/// unrelated stream.
#[test]
fn test_backend_fails_closed_without_a_false_stdout_marker() {
    let Some(source) = registry_source() else {
        require_candidate_source("CI requires the Ratatui core candidate source");
        eprintln!(
            "skipped: ratatui-core {} is not unpacked in this registry",
            core_version()
        );
        return;
    };
    let copy = scratch("publish-core");
    copy_out(&source, &copy).expect("copy out");
    let manifest = read_manifest(&patch_set_dir().join("manifest.json")).expect("manifest");
    apply(&manifest, &patch_set_dir(), &copy, &probe_dir()).expect("applies");

    let app = scratch("publish-app");
    std::fs::create_dir_all(app.join("src")).expect("app dir");
    std::fs::write(
        app.join("Cargo.toml"),
        format!("[package]\nname = \"publishing-app\"\nversion = \"0.1.0\"\nedition = \"2021\"\n\n[dependencies]\n{}", app_dependencies()),
    )
    .expect("manifest");
    std::fs::write(
        app.join("src/main.rs"),
        r#"use ratatui::widgets::{Block, List, Paragraph};

fn main() {
    let backend = ratatui::backend::TestBackend::new(40, 10);
    let mut terminal = ratatui::Terminal::new(backend).expect("terminal");
    terminal
        .draw(|frame| {
            let area = frame.area();
            frame.render_widget(Block::bordered().title("Permission"), area);
            frame.render_widget(Paragraph::new("Approve?"), area);
            frame.render_widget(List::new(["yes", "no"]), area);
        })
        .expect("draw");
    println!("drew a frame");
}

"#,
    )
    .expect("source");

    // A short socket path: the 104-byte sockaddr_un limit is easy to exceed
    // under a temp directory, and the failure looks like a driver that never
    // accepted.
    let socket = format!("/tmp/tw-ratatui-{}.sock", std::process::id());
    let _ = std::fs::remove_file(&socket);
    let received = start_driver(&socket);

    let patch = format!("patch.crates-io.ratatui-core.path='{}'", copy.display());
    let run = Command::new(std::env::var("CARGO").unwrap_or_else(|_| "cargo".into()))
        .args(["run", "--quiet", "--config", &patch])
        .current_dir(&app)
        .env("TERMWRIGHT_ENDPOINT", &socket)
        .env("TERMWRIGHT_TOKEN", "test-token")
        .env("TERMWRIGHT_RATATUI_VERSION", framework_version())
        .output()
        .expect("cargo runs");
    assert!(
        run.status.success(),
        "the instrumented app failed:\n{}",
        String::from_utf8_lossy(&run.stderr)
    );

    let mut hello = None;
    let mut snapshot = None;
    let mut protocol_error = None;
    for message in received {
        match message.get("type").and_then(serde_json::Value::as_str) {
            Some("hello") => hello = Some(message),
            Some("semantic-full") => snapshot = Some(message),
            Some("error") => protocol_error = Some(message),
            _ => {}
        }
    }

    let hello = hello.expect("the app never completed a handshake");
    let declared = hello
        .get("probe")
        .expect("the driver cannot tell this is a probe");
    assert_eq!(declared["framework"], "ratatui");
    assert_eq!(
        declared["identityKind"], "frame-local",
        "the probe claimed an identity Ratatui cannot support"
    );
    assert_eq!(declared["frameworkVersion"], framework_version());
    assert_eq!(hello["protocol"], "termwright/3");
    assert!(
        snapshot.is_none(),
        "unsupported backend published: {snapshot:?}"
    );
    let protocol_error = protocol_error.expect("unsupported backend did not fail the session");
    assert_eq!(protocol_error["code"], "adapter-guarantee-violation");
    assert!(
        protocol_error["message"]
            .as_str()
            .is_some_and(|message| message.contains("no certified render-commit marker sink")),
        "diagnostic did not name the missing guarantee: {protocol_error}"
    );
    assert!(
        !String::from_utf8_lossy(&run.stdout).contains("\u{1b}]8487;"),
        "TestBackend leaked a false marker onto process stdout"
    );

    let _ = std::fs::remove_file(&socket);
    let _ = std::fs::remove_dir_all(&copy);
    let _ = std::fs::remove_dir_all(&app);
}

/// Crossterm owns a concrete `W`, so its certified hook can prove the causal
/// order directly: render bytes and marker are observed in one captured sink.
#[test]
fn crossterm_commits_after_frame_bytes_on_the_exact_same_writer() {
    if registry_source().is_none() || crossterm_source().is_none() {
        require_candidate_source("CI requires both Ratatui core and Crossterm candidate sources");
        eprintln!("skipped: pinned Ratatui/Crossterm sources are not unpacked");
        return;
    }
    let app = scratch("same-sink-app");
    std::fs::create_dir_all(app.join("src")).expect("app dir");
    std::fs::write(
        app.join("Cargo.toml"),
        format!("[package]\nname = \"same-sink-app\"\nversion = \"0.1.0\"\nedition = \"2021\"\n\n[dependencies]\n{}", app_dependencies()),
    )
    .expect("manifest");
    std::fs::write(
        app.join("src/main.rs"),
        r#"use std::io::{self, Write};
use std::sync::{Arc, Mutex};

#[derive(Clone)]
struct Capture(Arc<Mutex<Vec<u8>>>);

impl Write for Capture {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        self.0.lock().unwrap().extend_from_slice(bytes);
        Ok(bytes.len())
    }
    fn flush(&mut self) -> io::Result<()> { Ok(()) }
}

fn main() {
    let captured = Arc::new(Mutex::new(Vec::new()));
    let backend = ratatui::backend::CrosstermBackend::new(Capture(captured.clone()));
    let options = ratatui::TerminalOptions {
        viewport: ratatui::Viewport::Fixed(ratatui::layout::Rect::new(0, 0, 20, 5)),
    };
    let mut terminal = ratatui::Terminal::with_options(backend, options).expect("terminal");
    terminal.draw(|frame| {
        frame.render_widget(ratatui::widgets::Paragraph::new("FRAME-BYTES"), frame.area());
    }).expect("draw");
    std::fs::write(std::env::var_os("CAPTURE_PATH").unwrap(), captured.lock().unwrap().as_slice())
        .expect("capture");
}
"#,
    )
    .expect("source");

    let prepared = prepare_instrumented_build(&PrepareOptions {
        project: app.clone(),
        workspace: Some(scratch("same-sink-workspace")),
        probe: Some(probe_dir()),
    })
    .expect("prepare all three pinned crates");
    let socket = format!("/tmp/tw-ratatui-sink-{}.sock", std::process::id());
    let _ = std::fs::remove_file(&socket);
    let received = start_driver(&socket);
    let capture = app.join("writer.bin");
    let mut command = Command::new(std::env::var("CARGO").unwrap_or_else(|_| "cargo".into()));
    command.args(["run", "--quiet"]).current_dir(&app);
    for config in &prepared.config_args {
        command.arg("--config").arg(config);
    }
    for (key, value) in &prepared.env {
        command.env(key, value);
    }
    let run = command
        .env("TERMWRIGHT_ENDPOINT", &socket)
        .env("TERMWRIGHT_TOKEN", "test-token")
        .env("CAPTURE_PATH", &capture)
        .output()
        .expect("cargo run");
    prepared.finish().expect("restore lock");
    assert!(
        run.status.success(),
        "same-sink app failed:\n{}",
        String::from_utf8_lossy(&run.stderr)
    );

    let mut snapshot = None;
    for message in received {
        if message["type"] == "semantic-full" {
            snapshot = Some(message);
        }
    }
    assert!(
        snapshot.is_some(),
        "Crossterm published no semantic snapshot"
    );
    let bytes = std::fs::read(&capture).expect("captured writer bytes");
    let frame_at = bytes
        .windows(b"FRAME-BYTES".len())
        .position(|window| window == b"FRAME-BYTES")
        .expect("render bytes absent from backend writer");
    let marker_at = bytes
        .windows(b"\x1b]8487;".len())
        .position(|window| window == b"\x1b]8487;")
        .expect("marker absent from backend writer");
    assert!(
        frame_at < marker_at,
        "marker preceded frame bytes: {bytes:?}"
    );
    assert!(
        !run.stdout
            .windows(b"\x1b]8487;".len())
            .any(|window| window == b"\x1b]8487;"),
        "marker escaped through process stdout instead of Crossterm's writer"
    );

    let _ = std::fs::remove_file(&socket);
    let _ = std::fs::remove_dir_all(&app);
}

/// Terminal lifetimes, frame abortion and process shutdown are causal
/// boundaries, not timing guesses. Two live Terminals share one ordered
/// publisher; an aborted callback contributes nothing; final drop drains the
/// last admitted frame; and a later lifecycle starts a fresh session.
#[test]
fn nested_and_multiple_terminals_preserve_order_and_restart_after_a_clean_final_drop() {
    if registry_source().is_none() || crossterm_source().is_none() {
        require_candidate_source("CI requires both Ratatui core and Crossterm candidate sources");
        eprintln!("skipped: pinned Ratatui/Crossterm sources are not unpacked");
        return;
    }
    let app = scratch("terminal-lifecycle-app");
    std::fs::create_dir_all(app.join("src")).expect("app dir");
    std::fs::write(
        app.join("Cargo.toml"),
        format!("[package]\nname = \"terminal-lifecycle-app\"\nversion = \"0.1.0\"\nedition = \"2021\"\n\n[dependencies]\n{}", app_dependencies()),
    )
    .expect("manifest");
    std::fs::write(
        app.join("src/main.rs"),
        r#"use std::io::{self, Write};
use std::sync::{Arc, Mutex};

#[derive(Clone)]
struct Capture(Arc<Mutex<Vec<u8>>>);

impl Write for Capture {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        self.0.lock().unwrap().extend_from_slice(bytes);
        Ok(bytes.len())
    }
    fn flush(&mut self) -> io::Result<()> { Ok(()) }
}

type CapturedTerminal = ratatui::Terminal<ratatui::backend::CrosstermBackend<Capture>>;

fn terminal(captured: &Arc<Mutex<Vec<u8>>>) -> CapturedTerminal {
    let backend = ratatui::backend::CrosstermBackend::new(Capture(captured.clone()));
    let options = ratatui::TerminalOptions {
        viewport: ratatui::Viewport::Fixed(ratatui::layout::Rect::new(0, 0, 20, 5)),
    };
    ratatui::Terminal::with_options(backend, options).expect("terminal")
}

fn draw(terminal: &mut CapturedTerminal, text: &'static str) {
    terminal.draw(|frame| {
        frame.render_widget(ratatui::widgets::Paragraph::new(text), frame.area());
    }).expect("draw");
}

fn main() {
    let captured = Arc::new(Mutex::new(Vec::new()));

    let mut first = terminal(&captured);
    let mut second = terminal(&captured);
    let mut nested = terminal(&captured);
    first.try_draw(|frame| -> Result<(), io::Error> {
        frame.render_widget(ratatui::widgets::Paragraph::new("OUTER"), frame.area());
        draw(&mut nested, "NESTED");
        Ok(())
    }).expect("nested draw");
    draw(&mut first, "ONE");

    let aborted = second.try_draw(|frame| -> Result<(), io::Error> {
        frame.render_widget(ratatui::widgets::Paragraph::new("ABORTED"), frame.area());
        Err(io::Error::other("abort before apply"))
    });
    assert!(aborted.is_err());

    draw(&mut second, "TWO");
    drop(first);
    draw(&mut second, "LAST");
    drop(second);
    drop(nested); // final guard drains semantic session one, including LAST

    let mut restarted = terminal(&captured);
    draw(&mut restarted, "RESTART");
    drop(restarted); // drains semantic session two

    std::fs::write(std::env::var_os("CAPTURE_PATH").unwrap(), captured.lock().unwrap().as_slice())
        .expect("capture");
}
"#,
    )
    .expect("source");

    let prepared = prepare_instrumented_build(&PrepareOptions {
        project: app.clone(),
        workspace: Some(scratch("terminal-lifecycle-workspace")),
        probe: Some(probe_dir()),
    })
    .expect("prepare instrumented build");
    let socket = format!("/tmp/tw-ratatui-life-{}.sock", std::process::id());
    let _ = std::fs::remove_file(&socket);
    let received = start_driver_sessions(&socket, 2);
    let capture = app.join("writer.bin");
    let mut command = Command::new(std::env::var("CARGO").unwrap_or_else(|_| "cargo".into()));
    command.args(["run", "--quiet"]).current_dir(&app);
    for config in &prepared.config_args {
        command.arg("--config").arg(config);
    }
    for (key, value) in &prepared.env {
        command.env(key, value);
    }
    let run = command
        .env("TERMWRIGHT_ENDPOINT", &socket)
        .env("TERMWRIGHT_TOKEN", "test-token")
        .env("CAPTURE_PATH", &capture)
        .output()
        .expect("cargo run");
    prepared.finish().expect("restore lock");
    assert!(
        run.status.success(),
        "terminal lifecycle app failed:\n{}",
        String::from_utf8_lossy(&run.stderr)
    );

    // The child has exited, so no legitimate semantic connection can still
    // begin. A zero-message sentinel causally releases the driver's final
    // accept if the expected restart never happened; the assertions below
    // then report the missing session instead of leaving the test thread
    // blocked forever. When both sessions completed, connect simply fails
    // because the listener is already gone.
    if let Ok(sentinel) = std::os::unix::net::UnixStream::connect(&socket) {
        drop(sentinel);
    }

    // Channel closure follows EOF from the second lifecycle or the post-exit
    // sentinel above; no polling window participates in the assertion.
    let messages: Vec<_> = received.into_iter().collect();
    let sessions: Vec<_> = messages
        .iter()
        .filter(|message| message["type"] == "hello")
        .map(|message| message["probe"]["framework"].as_str())
        .collect();
    assert_eq!(sessions, [Some("ratatui"), Some("ratatui")]);
    let snapshots: Vec<_> = messages
        .iter()
        .filter(|message| message["type"] == "semantic-full")
        .map(|message| message["snapshot"]["revision"].as_i64())
        .collect();
    assert_eq!(
        snapshots,
        [Some(1), Some(2), Some(3), Some(4), Some(5), Some(1)],
        "aborted frame leaked, terminals did not share a session, or restart did not reset it: {messages:?}"
    );
    let commits: Vec<_> = messages
        .iter()
        .filter(|message| message["type"] == "revision-commit")
        .map(|message| message["revision"].as_i64())
        .collect();
    assert_eq!(commits, snapshots, "snapshot/commit ordering diverged");

    let bytes = std::fs::read(&capture).expect("captured writer bytes");
    assert!(
        !bytes
            .windows(b"ABORTED".len())
            .any(|window| window == b"ABORTED"),
        "an aborted callback reached the backend"
    );
    let mut cursor = 0;
    for needle in [
        b"NESTED".as_slice(),
        b"]8487;twm;1;".as_slice(),
        b"OUTER".as_slice(),
        b"]8487;twm;2;".as_slice(),
        // ONE shares its leading O with OUTER, so Ratatui's diff correctly
        // emits only "NE"; revision 3 is the unambiguous commit boundary.
        b"]8487;twm;3;".as_slice(),
        b"TWO".as_slice(),
        b"]8487;twm;4;".as_slice(),
        b"LAST".as_slice(),
        b"]8487;twm;5;".as_slice(),
        b"RESTART".as_slice(),
        b"]8487;twm;1;".as_slice(),
    ] {
        let offset = bytes[cursor..]
            .windows(needle.len())
            .position(|window| window == needle)
            .unwrap_or_else(|| panic!("ordered writer datum {needle:?} absent after {cursor}"));
        cursor += offset + needle.len();
    }

    let _ = std::fs::remove_file(&socket);
    let _ = std::fs::remove_dir_all(&app);
}

/// One terminal is deliberately held inside its certified marker writer while
/// a second terminal completes a frame. The second render must never wait for
/// the first: it renders visually, semantic admission fails closed, and the
/// only marker emitted remains after the bytes it actually commits.
#[test]
fn concurrent_terminals_do_not_block_or_overtake_marker_order() {
    if registry_source().is_none() || crossterm_source().is_none() {
        require_candidate_source("CI requires both Ratatui core and Crossterm candidate sources");
        eprintln!("skipped: pinned Ratatui/Crossterm sources are not unpacked");
        return;
    }
    let app = scratch("concurrent-terminal-app");
    std::fs::create_dir_all(app.join("src")).expect("app dir");
    std::fs::write(
        app.join("Cargo.toml"),
        format!("[package]\nname = \"concurrent-terminal-app\"\nversion = \"0.1.0\"\nedition = \"2021\"\n\n[dependencies]\n{}", app_dependencies()),
    )
    .expect("manifest");
    std::fs::write(
        app.join("src/main.rs"),
        r#"use std::io::{self, Read, Write};
use std::sync::{mpsc, Arc, Mutex};

struct GateCapture {
    bytes: Arc<Mutex<Vec<u8>>>,
    entered: Option<mpsc::SyncSender<()>>,
    release: Arc<Mutex<mpsc::Receiver<()>>>,
}

impl Write for GateCapture {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        self.bytes.lock().unwrap().extend_from_slice(bytes);
        if bytes.windows(b"\x1b]8487;".len()).any(|window| window == b"\x1b]8487;") {
            if let Some(entered) = self.entered.take() {
                entered.send(()).unwrap();
                self.release.lock().unwrap().recv().unwrap();
            }
        }
        Ok(bytes.len())
    }
    fn flush(&mut self) -> io::Result<()> { Ok(()) }
}

#[derive(Clone)]
struct Capture(Arc<Mutex<Vec<u8>>>);
impl Write for Capture {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        self.0.lock().unwrap().extend_from_slice(bytes);
        Ok(bytes.len())
    }
    fn flush(&mut self) -> io::Result<()> { Ok(()) }
}

fn options() -> ratatui::TerminalOptions {
    ratatui::TerminalOptions {
        viewport: ratatui::Viewport::Fixed(ratatui::layout::Rect::new(0, 0, 20, 5)),
    }
}

fn main() {
    let first_bytes = Arc::new(Mutex::new(Vec::new()));
    let second_bytes = Arc::new(Mutex::new(Vec::new()));
    let (entered_tx, entered_rx) = mpsc::sync_channel(0);
    let (release_tx, release_rx) = mpsc::sync_channel(0);
    let first_backend = ratatui::backend::CrosstermBackend::new(GateCapture {
        bytes: first_bytes.clone(),
        entered: Some(entered_tx),
        release: Arc::new(Mutex::new(release_rx)),
    });
    let second_backend = ratatui::backend::CrosstermBackend::new(Capture(second_bytes.clone()));
    let mut first = ratatui::Terminal::with_options(first_backend, options()).unwrap();
    let mut second = ratatui::Terminal::with_options(second_backend, options()).unwrap();

    let first_thread = std::thread::spawn(move || {
        first.draw(|frame| frame.render_widget(
            ratatui::widgets::Paragraph::new("FIRST"), frame.area()
        )).unwrap();
        first
    });
    entered_rx.recv().unwrap(); // first is holding the non-blocking publication permit
    second.draw(|frame| frame.render_widget(
        ratatui::widgets::Paragraph::new("SECOND"), frame.area()
    )).unwrap(); // must complete while the first marker writer is still held
    release_tx.send(()).unwrap();
    let first = first_thread.join().unwrap();

    std::fs::write(std::env::var_os("FIRST_CAPTURE").unwrap(), first_bytes.lock().unwrap().as_slice()).unwrap();
    std::fs::write(std::env::var_os("SECOND_CAPTURE").unwrap(), second_bytes.lock().unwrap().as_slice()).unwrap();
    let mut release = [0u8; 1];
    std::io::stdin().read_exact(&mut release).unwrap(); // driver observed fatal while both live
    drop(first);
    drop(second);
}
"#,
    )
    .expect("source");

    let prepared = prepare_instrumented_build(&PrepareOptions {
        project: app.clone(),
        workspace: Some(scratch("concurrent-terminal-workspace")),
        probe: Some(probe_dir()),
    })
    .expect("prepare instrumented build");
    let socket = format!("/tmp/tw-ratatui-concurrent-{}.sock", std::process::id());
    let _ = std::fs::remove_file(&socket);
    let received = start_driver(&socket);
    let first_capture = app.join("first.bin");
    let second_capture = app.join("second.bin");
    let mut command = Command::new(std::env::var("CARGO").unwrap_or_else(|_| "cargo".into()));
    command.args(["run", "--quiet"]).current_dir(&app);
    for config in &prepared.config_args {
        command.arg("--config").arg(config);
    }
    for (key, value) in &prepared.env {
        command.env(key, value);
    }
    let mut child = command
        .env("TERMWRIGHT_ENDPOINT", &socket)
        .env("TERMWRIGHT_TOKEN", "test-token")
        .env("FIRST_CAPTURE", &first_capture)
        .env("SECOND_CAPTURE", &second_capture)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("spawn cargo run");

    let mut messages = Vec::new();
    loop {
        let message = received
            .recv()
            .expect("semantic channel closed before the contention error");
        let fatal = message["type"] == "error";
        messages.push(message);
        if fatal {
            break;
        }
    }
    std::io::Write::write_all(child.stdin.as_mut().expect("child stdin"), b"x")
        .expect("release live terminals after fatal");
    let run = child.wait_with_output().expect("cargo run completes");
    prepared.finish().expect("restore lock");
    assert!(
        run.status.success(),
        "concurrent terminal app failed:\n{}",
        String::from_utf8_lossy(&run.stderr)
    );

    let snapshots = messages
        .iter()
        .filter(|message| message["type"] == "semantic-full")
        .count();
    assert_eq!(
        snapshots, 1,
        "concurrent frame escaped semantic admission: {messages:?}"
    );
    let fatal = messages
        .iter()
        .find(|message| message["type"] == "error")
        .expect("concurrent render contention did not fail semantics");
    assert_eq!(fatal["code"], "adapter-guarantee-violation");

    let first = std::fs::read(&first_capture).expect("first capture");
    let second = std::fs::read(&second_capture).expect("second capture");
    let frame = first
        .windows(b"FIRST".len())
        .position(|bytes| bytes == b"FIRST")
        .unwrap();
    let marker = first
        .windows(b"\x1b]8487;".len())
        .position(|bytes| bytes == b"\x1b]8487;")
        .unwrap();
    assert!(frame < marker, "the admitted marker overtook its own frame");
    assert!(second
        .windows(b"SECOND".len())
        .any(|bytes| bytes == b"SECOND"));
    assert!(!second
        .windows(b"\x1b]8487;".len())
        .any(|bytes| bytes == b"\x1b]8487;"));

    let _ = std::fs::remove_file(&socket);
    let _ = std::fs::remove_dir_all(&app);
}

/// A certified sink can still fail after the visual frame was flushed. That
/// terminates semantics with a typed error; it must not fail the application's
/// draw, retry on a later frame, or redirect the marker to stdout.
#[test]
fn crossterm_marker_write_failure_is_fatal_without_fallback_or_retry() {
    if registry_source().is_none() || crossterm_source().is_none() {
        require_candidate_source("CI requires both Ratatui core and Crossterm candidate sources");
        eprintln!("skipped: pinned Ratatui/Crossterm sources are not unpacked");
        return;
    }
    let app = scratch("marker-failure-app");
    std::fs::create_dir_all(app.join("src")).expect("app dir");
    std::fs::write(
        app.join("Cargo.toml"),
        format!("[package]\nname = \"marker-failure-app\"\nversion = \"0.1.0\"\nedition = \"2021\"\n\n[dependencies]\n{}", app_dependencies()),
    )
    .expect("manifest");
    std::fs::write(
        app.join("src/main.rs"),
        r#"use std::io::{self, Write};
use std::sync::{Arc, Mutex};

#[derive(Clone)]
struct RejectMarker(Arc<Mutex<Vec<u8>>>);

impl Write for RejectMarker {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        if bytes.starts_with(b"\x1b]8487;") {
            return Err(io::Error::new(io::ErrorKind::BrokenPipe, "marker rejected"));
        }
        self.0.lock().unwrap().extend_from_slice(bytes);
        Ok(bytes.len())
    }
    fn flush(&mut self) -> io::Result<()> { Ok(()) }
}

fn main() {
    let captured = Arc::new(Mutex::new(Vec::new()));
    let backend = ratatui::backend::CrosstermBackend::new(RejectMarker(captured.clone()));
    let options = ratatui::TerminalOptions {
        viewport: ratatui::Viewport::Fixed(ratatui::layout::Rect::new(0, 0, 20, 5)),
    };
    let mut terminal = ratatui::Terminal::with_options(backend, options).expect("terminal");
    terminal.draw(|frame| {
        frame.render_widget(ratatui::widgets::Paragraph::new("FIRST-FRAME"), frame.area());
    }).expect("first visual draw remains successful");
    terminal.draw(|frame| {
        frame.render_widget(ratatui::widgets::Paragraph::new("SECOND-FRAME"), frame.area());
    }).expect("second visual draw remains successful");
    std::fs::write(std::env::var_os("CAPTURE_PATH").unwrap(), captured.lock().unwrap().as_slice())
        .expect("capture");
}
"#,
    )
    .expect("source");

    let prepared = prepare_instrumented_build(&PrepareOptions {
        project: app.clone(),
        workspace: Some(scratch("marker-failure-workspace")),
        probe: Some(probe_dir()),
    })
    .expect("prepare instrumented build");
    let socket = format!("/tmp/tw-ratatui-fail-{}.sock", std::process::id());
    let _ = std::fs::remove_file(&socket);
    let received = start_driver(&socket);
    let capture = app.join("writer.bin");
    let mut command = Command::new(std::env::var("CARGO").unwrap_or_else(|_| "cargo".into()));
    command.args(["run", "--quiet"]).current_dir(&app);
    for config in &prepared.config_args {
        command.arg("--config").arg(config);
    }
    for (key, value) in &prepared.env {
        command.env(key, value);
    }
    let run = command
        .env("TERMWRIGHT_ENDPOINT", &socket)
        .env("TERMWRIGHT_TOKEN", "test-token")
        .env("CAPTURE_PATH", &capture)
        .output()
        .expect("cargo run");
    prepared.finish().expect("restore lock");
    assert!(
        run.status.success(),
        "semantic failure changed application success:\n{}",
        String::from_utf8_lossy(&run.stderr)
    );

    let mut snapshots = 0;
    let mut fatal = None;
    for message in received {
        if message["type"] == "semantic-full" {
            snapshots += 1;
        } else if message["type"] == "error" {
            fatal = Some(message);
        }
    }
    assert_eq!(
        snapshots, 1,
        "later frame was published after marker failure"
    );
    let fatal = fatal.expect("marker writer failure did not terminate semantics");
    assert_eq!(fatal["code"], "adapter-guarantee-violation");
    assert!(
        fatal["message"].as_str().is_some_and(|message| {
            message.contains("certified Ratatui marker sink failed")
                && message.contains("marker rejected")
        }),
        "wrong marker failure diagnostic: {fatal}"
    );
    let bytes = std::fs::read(&capture).expect("captured writer bytes");
    assert!(
        bytes
            .windows(b"FIRST-FRAME".len())
            .any(|window| window == b"FIRST-FRAME"),
        "first visual frame was not flushed"
    );
    assert!(
        bytes
            .windows(b"SECOND-FRAME".len())
            .any(|window| window == b"SECOND-FRAME"),
        "second visual frame was not allowed to render"
    );
    assert!(
        !bytes
            .windows(b"\x1b]8487;".len())
            .any(|window| window == b"\x1b]8487;")
            && !run
                .stdout
                .windows(b"\x1b]8487;".len())
                .any(|window| window == b"\x1b]8487;"),
        "failed marker was emitted or redirected to stdout"
    );

    let _ = std::fs::remove_file(&socket);
    let _ = std::fs::remove_dir_all(&app);
}

/// A backend that advertises the sink and then returns `Ok(false)` has broken
/// the same contract as a writer error. Even when this is the process's last
/// frame, final Terminal drop must drain the typed fatal after the invalidated
/// snapshot, and no guessed stdout marker is allowed.
#[test]
fn a_backend_cannot_withdraw_its_marker_sink_after_publication() {
    if registry_source().is_none() || crossterm_source().is_none() {
        require_candidate_source("CI requires both Ratatui core and Crossterm candidate sources");
        eprintln!("skipped: pinned Ratatui/Crossterm sources are not unpacked");
        return;
    }
    let app = scratch("marker-withdrawal-app");
    std::fs::create_dir_all(app.join("src")).expect("app dir");
    std::fs::write(
        app.join("Cargo.toml"),
        format!("[package]\nname = \"marker-withdrawal-app\"\nversion = \"0.1.0\"\nedition = \"2021\"\n\n[dependencies]\n{}", app_dependencies()),
    )
    .expect("manifest");
    std::fs::write(
        app.join("src/main.rs"),
        r#"use std::io::{self, Write};
use std::sync::{Arc, Mutex};

use ratatui::backend::{Backend, ClearType, CrosstermBackend, WindowSize};
use ratatui::buffer::Cell;
use ratatui::layout::{Position, Size};

#[derive(Clone)]
struct Capture(Arc<Mutex<Vec<u8>>>);

impl Write for Capture {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        self.0.lock().unwrap().extend_from_slice(bytes);
        Ok(bytes.len())
    }
    fn flush(&mut self) -> io::Result<()> { Ok(()) }
}

struct Withdraw(Builtin);
type Builtin = CrosstermBackend<Capture>;

impl Backend for Withdraw {
    type Error = io::Error;

    fn draw<'a, I>(&mut self, content: I) -> io::Result<()>
    where
        I: Iterator<Item = (u16, u16, &'a Cell)>,
    {
        self.0.draw(content)
    }
    fn hide_cursor(&mut self) -> io::Result<()> { self.0.hide_cursor() }
    fn show_cursor(&mut self) -> io::Result<()> { self.0.show_cursor() }
    fn get_cursor_position(&mut self) -> io::Result<Position> { self.0.get_cursor_position() }
    fn set_cursor_position<P: Into<Position>>(&mut self, position: P) -> io::Result<()> {
        self.0.set_cursor_position(position)
    }
    fn clear(&mut self) -> io::Result<()> { self.0.clear() }
    fn clear_region(&mut self, clear_type: ClearType) -> io::Result<()> {
        self.0.clear_region(clear_type)
    }
    fn size(&self) -> io::Result<Size> { self.0.size() }
    fn window_size(&mut self) -> io::Result<WindowSize> { self.0.window_size() }
    fn flush(&mut self) -> io::Result<()> { <Builtin as Backend>::flush(&mut self.0) }

    fn termwright_marker_sink_supported(&self) -> bool { true }
    fn termwright_write_marker(&mut self, _marker: &[u8]) -> io::Result<bool> { Ok(false) }
}

fn main() {
    let captured = Arc::new(Mutex::new(Vec::new()));
    let backend = Withdraw(CrosstermBackend::new(Capture(captured.clone())));
    let options = ratatui::TerminalOptions {
        viewport: ratatui::Viewport::Fixed(ratatui::layout::Rect::new(0, 0, 20, 5)),
    };
    let mut terminal = ratatui::Terminal::with_options(backend, options).expect("terminal");
    terminal.draw(|frame| {
        frame.render_widget(ratatui::widgets::Paragraph::new("FIRST-FRAME"), frame.area());
    }).expect("last visual draw remains successful");
    std::fs::write(std::env::var_os("CAPTURE_PATH").unwrap(), captured.lock().unwrap().as_slice())
        .expect("capture");
}
"#,
    )
    .expect("source");

    let prepared = prepare_instrumented_build(&PrepareOptions {
        project: app.clone(),
        workspace: Some(scratch("marker-withdrawal-workspace")),
        probe: Some(probe_dir()),
    })
    .expect("prepare instrumented build");
    let socket = format!("/tmp/tw-ratatui-withdrawal-{}.sock", std::process::id());
    let _ = std::fs::remove_file(&socket);
    let received = start_driver(&socket);
    let capture = app.join("writer.bin");
    let mut command = Command::new(std::env::var("CARGO").unwrap_or_else(|_| "cargo".into()));
    command.args(["run", "--quiet"]).current_dir(&app);
    for config in &prepared.config_args {
        command.arg("--config").arg(config);
    }
    for (key, value) in &prepared.env {
        command.env(key, value);
    }
    let run = command
        .env("TERMWRIGHT_ENDPOINT", &socket)
        .env("TERMWRIGHT_TOKEN", "test-token")
        .env("CAPTURE_PATH", &capture)
        .output()
        .expect("cargo run");
    prepared.finish().expect("restore lock");
    assert!(
        run.status.success(),
        "semantic withdrawal changed application success:\n{}",
        String::from_utf8_lossy(&run.stderr)
    );

    let mut snapshots = 0;
    let mut fatal = None;
    for message in received {
        if message["type"] == "semantic-full" {
            snapshots += 1;
        } else if message["type"] == "error" {
            fatal = Some(message);
        }
    }
    assert_eq!(snapshots, 1, "last frame was not admitted exactly once");
    let fatal = fatal.expect("sink withdrawal did not terminate semantics");
    assert_eq!(fatal["code"], "adapter-guarantee-violation");
    assert!(
        fatal["message"]
            .as_str()
            .is_some_and(|message| message.contains("withdrew its certified marker sink")),
        "wrong sink-withdrawal diagnostic: {fatal}"
    );
    let bytes = std::fs::read(&capture).expect("captured writer bytes");
    assert!(
        bytes
            .windows(b"FIRST-FRAME".len())
            .any(|window| window == b"FIRST-FRAME"),
        "last visual frame was suppressed by semantic failure: {bytes:?}"
    );
    assert!(
        !bytes
            .windows(b"\x1b]8487;".len())
            .any(|window| window == b"\x1b]8487;")
            && !run
                .stdout
                .windows(b"\x1b]8487;".len())
                .any(|window| window == b"\x1b]8487;"),
        "withdrawn marker was emitted or redirected to stdout"
    );

    let _ = std::fs::remove_file(&socket);
    let _ = std::fs::remove_dir_all(&app);
}

/// Phase 8, end to end: the public annotation SDK adds author intent to a
/// custom widget while the patched framework remains the source of geometry,
/// collection state and physical observations. An explicit semantic key is the one
/// deliberate exception to frame-local identity.
#[test]
fn an_annotated_custom_widget_merges_full_intent_without_physical_overrides() {
    if registry_source().is_none() || widgets_source().is_none() || crossterm_source().is_none() {
        assert_ne!(
            std::env::var("TERMWRIGHT_REQUIRE_RATATUI").as_deref(),
            Ok("1"),
            "CI requires all Ratatui candidate sources for the annotation fixture"
        );
        eprintln!("skipped: the Ratatui crates are not unpacked in this registry");
        return;
    }

    let app = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/annotated-app");
    let workspace = scratch("annotated-sdk-cache");
    let target = scratch("annotated-sdk-target");
    let prepared = prepare_instrumented_build(&PrepareOptions {
        project: app.clone(),
        workspace: Some(workspace.clone()),
        probe: Some(probe_dir()),
    })
    .expect("prepare annotated instrumented build");

    let socket = format!("/tmp/tw-ratatui-sdk-{}.sock", std::process::id());
    let _ = std::fs::remove_file(&socket);
    let received = start_driver(&socket);

    let mut command = Command::new(std::env::var("CARGO").unwrap_or_else(|_| "cargo".into()));
    command.args(["run", "--quiet"]).current_dir(&app);
    for config in &prepared.config_args {
        command.arg("--config").arg(config);
    }
    for (key, value) in &prepared.env {
        command.env(key, value);
    }
    let run = command
        .env("CARGO_TARGET_DIR", &target)
        .env("TERMWRIGHT_ENDPOINT", &socket)
        .env("TERMWRIGHT_TOKEN", "test-token")
        .output()
        .expect("annotated cargo run");
    prepared.finish().expect("restore annotated fixture lock");
    assert!(
        run.status.success(),
        "the annotated app failed:\n{}",
        String::from_utf8_lossy(&run.stderr)
    );

    let mut hello = None;
    let mut snapshot = None;
    for message in received {
        match message.get("type").and_then(serde_json::Value::as_str) {
            Some("hello") => hello = Some(message),
            Some("semantic-full") => snapshot = Some(message),
            _ => {}
        }
    }

    let hello = hello.expect("the annotated app never completed a handshake");
    assert_eq!(hello["probe"]["identityKind"], "frame-local");
    assert_eq!(
        hello["probe"]["capabilities"],
        serde_json::json!(["intended-rect", "operations", "annotations"])
    );
    let adapter_capabilities = hello["capabilities"]
        .as_array()
        .expect("hello adapter capabilities");
    assert!(adapter_capabilities.contains(&serde_json::json!("states")));
    assert!(adapter_capabilities.contains(&serde_json::json!("actions")));

    let snapshot = snapshot.expect("the annotated app published no snapshot");
    let tree = &snapshot["snapshot"];
    let validated =
        termwright_protocol::validate_snapshot(tree, &termwright_protocol::DEFAULT_LIMITS);
    assert!(validated.is_ok(), "invalid annotated tree: {validated:?}");
    let node = tree["nodes"]
        .as_array()
        .and_then(|nodes| nodes.iter().find(|node| node["testId"] == "deploy-release"))
        .expect("annotated custom widget node");

    assert_eq!(node["role"], "button");
    assert_eq!(node["name"], "Deploy");
    assert_eq!(node["description"], "Deploy the current release");
    assert_eq!(
        node["geometry"]["intendedRect"]["value"],
        serde_json::json!({
            "row": 2,
            "column": 3,
            "width": 20,
            "height": 2,
        })
    );
    assert_eq!(node["p"], "framework");
    for field in [
        "id",
        "role",
        "name",
        "description",
        "testId",
        "extended",
        "actions",
        "labelledBy",
        "describedBy",
    ] {
        assert_eq!(node["px"][field], "annotation", "{field}: {node}");
    }
    assert_eq!(node["extended"]["deployment"]["status"], "ready");
    assert_eq!(node["extended"]["deployment"]["attempt"], 3);
    assert_eq!(node["extended"]["actions"], serde_json::json!(["click"]));
    assert_eq!(node["actions"], serde_json::json!(["activate"]));
    assert_eq!(
        node["labelledBy"],
        serde_json::json!(["k:deployment-label"])
    );
    assert_eq!(node["describedBy"], node["labelledBy"]);
    assert!(
        node["frameworkType"]
            .as_str()
            .is_some_and(|name| name.ends_with("DeployWidget")),
        "the wrapper hid the application's widget type: {node}"
    );
    assert_eq!(node["id"], "k:deployment-control");
    assert_eq!(node["parentId"], "k:deployment-group");
    assert_eq!(
        tree["nodes"]
            .as_array()
            .expect("nodes")
            .iter()
            .filter(|candidate| candidate["id"] == "k:deployment-control")
            .count(),
        1,
        "direct Annotated render was duplicated: {tree}"
    );

    assert!(
        String::from_utf8_lossy(&run.stdout).contains("\u{1b}]8487;"),
        "the annotated frame had no commit marker"
    );

    let _ = std::fs::remove_file(&socket);
    let _ = std::fs::remove_dir_all(&workspace);
    let _ = std::fs::remove_dir_all(&target);
}

/// The core of Ratatui's semantics: a selected row in a real list.
///
/// This is the test that justifies patching a second crate. `ratatui-core`
/// sees the stateful render happen but cannot read the state —
/// `StatefulWidget::State` is `?Sized`, so it cannot even be downcast — while
/// `ratatui-widgets` knows the concrete `ListState` and, being inside the
/// crate, can reach `List::items`, which is `pub(crate)`. The item names and
/// the item count come from there and nowhere else.
#[test]
fn a_list_publishes_its_items_and_the_selected_row() {
    let (Some(core_source), Some(widgets_source), Some(crossterm_source)) =
        (registry_source(), widgets_source(), crossterm_source())
    else {
        assert_ne!(
            std::env::var("TERMWRIGHT_REQUIRE_RATATUI").as_deref(),
            Ok("1"),
            "CI requires all Ratatui candidate sources for the list fixture"
        );
        eprintln!("skipped: the Ratatui crates are not unpacked in this registry");
        return;
    };

    let core_copy = scratch("list-core");
    copy_out(&core_source, &core_copy).expect("copy out core");
    let core_manifest = read_manifest(&patch_set_dir().join("manifest.json")).expect("manifest");
    apply(&core_manifest, &patch_set_dir(), &core_copy, &probe_dir()).expect("core applies");

    let widgets_copy = scratch("list-widgets");
    copy_out(&widgets_source, &widgets_copy).expect("copy out widgets");
    let widgets_manifest =
        read_manifest(&widgets_patch_set_dir().join("manifest.json")).expect("widgets manifest");
    apply(
        &widgets_manifest,
        &widgets_patch_set_dir(),
        &widgets_copy,
        &probe_dir(),
    )
    .expect("widgets applies");

    let crossterm_copy = scratch("list-crossterm");
    copy_out(&crossterm_source, &crossterm_copy).expect("copy out crossterm");
    let crossterm_manifest = read_manifest(&crossterm_patch_set_dir().join("manifest.json"))
        .expect("crossterm manifest");
    apply(
        &crossterm_manifest,
        &crossterm_patch_set_dir(),
        &crossterm_copy,
        &probe_dir(),
    )
    .expect("crossterm applies");

    let app = scratch("list-app");
    std::fs::create_dir_all(app.join("src")).expect("app dir");
    std::fs::write(
        app.join("Cargo.toml"),
        format!("[package]\nname = \"list-app\"\nversion = \"0.1.0\"\nedition = \"2021\"\n\n[dependencies]\n{}", app_dependencies()),
    )
    .expect("manifest");
    std::fs::write(
        app.join("src/main.rs"),
        r#"use ratatui::widgets::{List, ListState};

fn main() {
    let backend = ratatui::backend::CrosstermBackend::new(std::io::stdout());
    let options = ratatui::TerminalOptions {
        viewport: ratatui::Viewport::Fixed(ratatui::layout::Rect::new(0, 0, 30, 6)),
    };
    let mut terminal = ratatui::Terminal::with_options(backend, options).expect("terminal");
    let mut state = ListState::default();
    state.select(Some(1));
    terminal
        .draw(|frame| {
            let list = List::new(["Approve", "Reject", "Postpone"]);
            frame.render_stateful_widget(list, frame.area(), &mut state);
        })
        .expect("draw");
    println!("drew a frame");
}
"#,
    )
    .expect("source");

    let socket = format!("/tmp/tw-ratatui-list-{}.sock", std::process::id());
    let _ = std::fs::remove_file(&socket);
    let received = start_driver(&socket);

    let run = Command::new(std::env::var("CARGO").unwrap_or_else(|_| "cargo".into()))
        .args([
            "run",
            "--quiet",
            "--config",
            &format!(
                "patch.crates-io.ratatui-core.path='{}'",
                core_copy.display()
            ),
            "--config",
            &format!(
                "patch.crates-io.ratatui-widgets.path='{}'",
                widgets_copy.display()
            ),
            "--config",
            &format!(
                "patch.crates-io.ratatui-crossterm.path='{}'",
                crossterm_copy.display()
            ),
        ])
        .current_dir(&app)
        .env("TERMWRIGHT_ENDPOINT", &socket)
        .env("TERMWRIGHT_TOKEN", "test-token")
        .output()
        .expect("cargo runs");
    assert!(
        run.status.success(),
        "the instrumented app failed:\n{}",
        String::from_utf8_lossy(&run.stderr)
    );

    let mut snapshot = None;
    for message in received {
        if message.get("type").and_then(serde_json::Value::as_str) == Some("semantic-full") {
            snapshot = Some(message);
        }
    }
    let snapshot = snapshot.expect("no tree reached the driver");
    let tree = &snapshot["snapshot"];
    let result = termwright_protocol::validate_snapshot(tree, &termwright_protocol::DEFAULT_LIMITS);
    assert!(result.is_ok(), "the published tree is invalid: {result:?}");

    let nodes = tree["nodes"].as_array().expect("nodes");
    let items: Vec<&serde_json::Value> = nodes
        .iter()
        .filter(|node| node["role"] == "listitem")
        .collect();
    assert_eq!(
        items.len(),
        3,
        "the list's rows did not reach the tree: {tree}"
    );

    let names: Vec<&str> = items
        .iter()
        .filter_map(|item| item["name"].as_str())
        .collect();
    assert_eq!(names, ["Approve", "Reject", "Postpone"], "{tree}");

    // setSize is the widget's own count, and positionInSet is one-based.
    for (index, item) in items.iter().enumerate() {
        assert_eq!(item["state"]["setSize"], 3, "{item}");
        assert_eq!(item["state"]["positionInSet"], index as i64 + 1, "{item}");
    }

    let selected: Vec<&str> = items
        .iter()
        .filter(|item| item["state"]["selected"] == true)
        .filter_map(|item| item["name"].as_str())
        .collect();
    assert_eq!(
        selected,
        ["Reject"],
        "the selected row is wrong, or the state was read before the render mutated it: {tree}"
    );

    let _ = std::fs::remove_file(&socket);
    for path in [&core_copy, &widgets_copy, &crossterm_copy, &app] {
        let _ = std::fs::remove_dir_all(path);
    }
}
