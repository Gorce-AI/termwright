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
use std::process::Command;

use termwright_probe_ratatui::launch::{prepare_instrumented_build, PrepareOptions};
use termwright_probe_ratatui::patchset::{apply, copy_out, digest_file, read_manifest};

fn core_version() -> String {
    std::env::var("TERMWRIGHT_CANDIDATE_RATATUI_CORE").unwrap_or_else(|_| "0.1.2".into())
}

fn widgets_version() -> String {
    std::env::var("TERMWRIGHT_CANDIDATE_RATATUI_WIDGETS").unwrap_or_else(|_| "0.3.2".into())
}

fn framework_version() -> String {
    std::env::var("TERMWRIGHT_CANDIDATE_RATATUI").unwrap_or_else(|_| "0.30.2".into())
}

fn app_dependencies() -> String {
    format!(
        "ratatui = \"={}\"\nratatui-core = \"={}\"\nratatui-widgets = \"={}\"\n",
        framework_version(),
        core_version(),
        widgets_version()
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
    let _ = std::fs::remove_dir_all(&copy);
}

/// A copy that is not the pinned version is refused before anything is edited.
#[test]
fn a_version_mismatch_is_refused_by_name() {
    let Some(source) = registry_source() else {
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
        text.contains("first render intercepted"),
        "the patched crate never called the probe:\n{text}"
    );
    assert!(
        text.contains("Paragraph"),
        "type_name did not survive the hook:\n{text}"
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

    let _ = std::fs::remove_dir_all(&copy);
    let _ = std::fs::remove_dir_all(&app);
}

// -- the definition of done for this framework ------------------------------

/// A driver end that completes the handshake and records what arrives.
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
                        "protocol": "termwright/2",
                        "sessionId": "s-e2e",
                        "limits": DEFAULT_LIMITS,
                        "subscribe": "snapshots",
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

/// Zero-config, end to end: an ordinary Ratatui application publishes a tree.
///
/// Everything above proves a piece. This proves the claim: an application that
/// imports nothing of ours, launched with one flag and two variables, hands a
/// real driver a validated semantic tree and commits it with a marker.
#[test]
fn a_vanilla_app_publishes_a_validated_tree() {
    use std::time::{Duration, Instant};

    let Some(source) = registry_source() else {
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

    let deadline = Instant::now() + Duration::from_secs(10);
    let mut hello = None;
    let mut snapshot = None;
    while Instant::now() < deadline && (hello.is_none() || snapshot.is_none()) {
        match received.recv_timeout(Duration::from_millis(200)) {
            Ok(message) => match message.get("type").and_then(serde_json::Value::as_str) {
                Some("hello") => hello = Some(message),
                Some("snapshot") => snapshot = Some(message),
                _ => {}
            },
            Err(_) => break,
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
    assert_eq!(hello["protocol"], "termwright/2");
    let snapshot = snapshot.expect("no tree reached the driver");
    let tree = &snapshot["snapshot"];
    let result = termwright_protocol::validate_snapshot(tree, &termwright_protocol::DEFAULT_LIMITS);
    assert!(result.is_ok(), "the published tree is invalid: {result:?}");

    let nodes = tree["nodes"].as_array().expect("nodes");
    assert!(!nodes.is_empty(), "the tree is empty: {tree}");
    assert_eq!(tree["v"], 2);
    assert_eq!(tree["hitGrid"]["status"], "unsupported");
    assert!(nodes.iter().all(|node| node.get("bounds").is_none()));
    assert!(nodes.iter().all(|node| node.get("occlusion").is_none()));
    assert!(nodes.iter().all(|node| node.get("geometry").is_some()));
    let roles: Vec<&str> = nodes
        .iter()
        .filter_map(|node| node["role"].as_str())
        .collect();
    assert!(
        roles.contains(&"region"),
        "no Block became a region: {roles:?}"
    );
    assert!(
        roles.contains(&"text"),
        "no Paragraph became text: {roles:?}"
    );
    assert!(roles.contains(&"list"), "no List became a list: {roles:?}");

    // The marker commits the frame, and it must follow the frame's bytes.
    let stdout = String::from_utf8_lossy(&run.stdout);
    assert!(
        stdout.contains("\u{1b}]8487;"),
        "no render-commit marker was written"
    );

    let _ = std::fs::remove_file(&socket);
    let _ = std::fs::remove_dir_all(&copy);
    let _ = std::fs::remove_dir_all(&app);
}

/// Phase 8, end to end: the public annotation SDK adds author intent to a
/// custom widget while the patched framework remains the source of geometry,
/// collection state and physical observations. An explicit semantic key is the one
/// deliberate exception to frame-local identity.
#[test]
fn an_annotated_custom_widget_merges_full_intent_without_physical_overrides() {
    use std::time::{Duration, Instant};

    if registry_source().is_none() || widgets_source().is_none() {
        assert_ne!(
            std::env::var("TERMWRIGHT_REQUIRE_RATATUI").as_deref(),
            Ok("1"),
            "CI requires both Ratatui patch sources for the annotation fixture"
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

    let deadline = Instant::now() + Duration::from_secs(10);
    let mut hello = None;
    let mut snapshot = None;
    while Instant::now() < deadline && (hello.is_none() || snapshot.is_none()) {
        match received.recv_timeout(Duration::from_millis(200)) {
            Ok(message) => match message.get("type").and_then(serde_json::Value::as_str) {
                Some("hello") => hello = Some(message),
                Some("snapshot") => snapshot = Some(message),
                _ => {}
            },
            Err(_) => break,
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
    use std::time::{Duration, Instant};

    let (Some(core_source), Some(widgets_source)) = (registry_source(), widgets_source()) else {
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
    let backend = ratatui::backend::TestBackend::new(30, 6);
    let mut terminal = ratatui::Terminal::new(backend).expect("terminal");
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

    let deadline = Instant::now() + Duration::from_secs(10);
    let mut snapshot = None;
    while Instant::now() < deadline && snapshot.is_none() {
        match received.recv_timeout(Duration::from_millis(200)) {
            Ok(message) => {
                if message.get("type").and_then(serde_json::Value::as_str) == Some("snapshot") {
                    snapshot = Some(message);
                }
            }
            Err(_) => break,
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
    for path in [&core_copy, &widgets_copy, &app] {
        let _ = std::fs::remove_dir_all(path);
    }
}
