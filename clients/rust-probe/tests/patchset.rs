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

use termwright_probe_ratatui::patchset::{apply, copy_out, digest_file, read_manifest};

const VERSION: &str = "0.1.2";

fn patch_set_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("upstream-patches/ratatui-core")
        .join(VERSION)
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
    let home = std::env::var_os("CARGO_HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".cargo")))?;
    let registries = home.join("registry/src");
    for entry in std::fs::read_dir(registries).ok()? {
        let candidate = entry.ok()?.path().join(format!("ratatui-core-{VERSION}"));
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
        eprintln!("skipped: ratatui-core {VERSION} is not unpacked in this registry");
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
        eprintln!("skipped: ratatui-core {VERSION} is not unpacked in this registry");
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
        eprintln!("skipped: ratatui-core {VERSION} is not unpacked in this registry");
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
        eprintln!("skipped: ratatui-core {VERSION} is not unpacked in this registry");
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
        eprintln!("skipped: ratatui-core {VERSION} is not unpacked in this registry");
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
        "[package]\nname = \"vanilla-app\"\nversion = \"0.1.0\"\nedition = \"2021\"\n\
         \n[dependencies]\nratatui = \"0.30\"\n",
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

    // And the same application, uninstrumented, leaves no trace.
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
    assert!(
        !dormant_log.exists(),
        "a dormant run still produced diagnostics"
    );

    let _ = std::fs::remove_dir_all(&copy);
    let _ = std::fs::remove_dir_all(&app);
}
