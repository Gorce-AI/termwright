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

    // Two crates are patched, so two flags come back.
    assert_eq!(prepared.config_args.len(), 2, "{:?}", prepared.config_args);
    assert!(prepared
        .config_args
        .iter()
        .any(|arg| arg.contains("ratatui-core")));
    assert!(prepared
        .config_args
        .iter()
        .any(|arg| arg.contains("ratatui-widgets")));
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
