//! The adapter-side diagnostic log: off by default, a file when asked, never
//! stderr.

use std::collections::HashMap;
use std::fs;
use std::sync::Arc;
use std::time::Duration;

use termwright_protocol::debug::{describe_endpoint, Category};
use termwright_protocol::{debug_path, Client, DebugLog, Options};

mod support;

fn env(pairs: &[(&str, &str)]) -> impl Fn(&str) -> Option<String> {
    let map: HashMap<String, String> = pairs
        .iter()
        .map(|(name, value)| ((*name).to_owned(), (*value).to_owned()))
        .collect();
    move |name: &str| map.get(name).cloned()
}

#[test]
fn off_without_any_variable() {
    assert!(debug_path(env(&[])).is_none());
}

/// `TERMWRIGHT_DEBUG=1` reaches the child process too, and the driver's own
/// destination is stderr — which the adapter cannot use, because the app owns
/// the terminal. A switch with no destination must leave the adapter silent.
#[test]
fn the_drivers_own_switches_do_not_name_a_file() {
    for value in [
        "", "1", "true", "on", "api", "all", "0", "false", "off", "ALL",
    ] {
        assert!(
            debug_path(env(&[("TERMWRIGHT_DEBUG", value)])).is_none(),
            "TERMWRIGHT_DEBUG={value:?} enabled the log"
        );
    }
}

#[test]
fn a_path_in_either_variable_enables_it() {
    assert_eq!(
        debug_path(env(&[("TERMWRIGHT_DEBUG", "/tmp/a.log")])).as_deref(),
        Some("/tmp/a.log")
    );
    assert_eq!(
        debug_path(env(&[("TERMWRIGHT_DEBUG_FILE", "/tmp/b.log")])).as_deref(),
        Some("/tmp/b.log")
    );
}

#[test]
fn the_file_variable_wins() {
    let chosen = debug_path(env(&[
        ("TERMWRIGHT_DEBUG", "/tmp/a.log"),
        ("TERMWRIGHT_DEBUG_FILE", "/tmp/b.log"),
    ]));
    assert_eq!(chosen.as_deref(), Some("/tmp/b.log"));
}

#[test]
fn lines_carry_category_label_and_elapsed_time() {
    let directory = support::temp_dir();
    let path = directory.join("adapter.log");
    let log = DebugLog::open(path.to_str().unwrap(), "test-adapter").expect("a log");
    log.line(Category::Sem, "hello sent");
    log.set_label("abcdef0123456789");
    log.line(Category::Io, "r1 snapshot nodes=3");
    log.close();

    let text = fs::read_to_string(&path).expect("readable");
    let lines: Vec<&str> = text.lines().collect();
    assert_eq!(lines.len(), 3, "{text}");
    assert!(lines[0].starts_with("  tw:diag "), "{}", lines[0]);
    assert!(lines[0].contains("adapter=test-adapter"), "{}", lines[0]);
    assert!(
        lines[1].starts_with(&format!("  tw:sem  [p{}]", std::process::id())),
        "{}",
        lines[1]
    );
    assert!(lines[1].ends_with("s hello sent"), "{}", lines[1]);
    // The session id replaces the pid once the handshake supplies one, and is
    // truncated to the driver's eight characters so both logs align.
    assert!(lines[2].starts_with("  tw:io   [abcdef01]"), "{}", lines[2]);
}

#[test]
fn it_appends_rather_than_truncating() {
    let directory = support::temp_dir();
    let path = directory.join("adapter.log");
    fs::write(&path, "earlier run\n").expect("writable");
    let log = DebugLog::open(path.to_str().unwrap(), "test").expect("a log");
    log.line(Category::Diag, "later run");
    log.close();

    let text = fs::read_to_string(&path).expect("readable");
    assert!(text.starts_with("earlier run\n"), "{text}");
    assert!(text.contains("later run"), "{text}");
}

/// A diagnostic that can break the application is worse than no diagnostic.
#[test]
fn an_unwritable_path_disables_the_log() {
    let directory = support::temp_dir();
    let path = directory.join("no-such-directory").join("adapter.log");
    assert!(DebugLog::open(path.to_str().unwrap(), "test").is_none());
}

#[test]
fn writing_after_close_is_silent() {
    let directory = support::temp_dir();
    let log = DebugLog::open(directory.join("a.log").to_str().unwrap(), "test").expect("a log");
    log.close();
    log.line(Category::Diag, "after close");
    log.close();
}

#[test]
fn describe_endpoint_names_the_transport() {
    assert!(describe_endpoint("/tmp/tw.sock").starts_with("unix:"));
    assert!(describe_endpoint(r"\\.\pipe\termwright-ab12").starts_with("pipe:"));
}

// -- the reason for staying dormant ---------------------------------------

fn options_logging_to(path: &std::path::Path) -> (Options, Arc<DebugLog>) {
    let log = Arc::new(DebugLog::open(path.to_str().unwrap(), "test").expect("a log"));
    let mut options = Options::new("test", "0.0.0");
    options.debug = Some(Arc::clone(&log));
    (options, log)
}

/// The line that explains a run where the adapter never attached.
#[test]
fn dormancy_reason_is_recorded() {
    let directory = support::temp_dir();
    let path = directory.join("adapter.log");
    let (options, log) = options_logging_to(&path);
    assert!(Client::from_values(None, None, options).is_none());
    log.close();

    let text = fs::read_to_string(&path).expect("readable");
    assert!(
        text.contains("dormant: TERMWRIGHT_ENDPOINT and TERMWRIGHT_TOKEN not set"),
        "{text}"
    );
}

#[test]
fn dormancy_reason_names_only_the_missing_variable() {
    let directory = support::temp_dir();
    let path = directory.join("adapter.log");
    let (options, log) = options_logging_to(&path);
    assert!(Client::from_values(Some("/tmp/x.sock"), None, options).is_none());
    log.close();

    let text = fs::read_to_string(&path).expect("readable");
    assert!(text.contains("dormant: TERMWRIGHT_TOKEN not set"), "{text}");
}

/// This client has no Windows transport, and a pipe path is the shape that
/// exposes it. The log is the only place that says so.
#[test]
fn a_pipe_endpoint_says_which_transport_is_missing() {
    let directory = support::temp_dir();
    let path = directory.join("adapter.log");
    let (options, log) = options_logging_to(&path);
    assert!(
        Client::from_values(Some(r"\\.\pipe\termwright-ab12"), Some("token"), options).is_none()
    );
    log.close();

    let text = fs::read_to_string(&path).expect("readable");
    assert!(text.contains("dormant: pipe:"), "{text}");
    assert!(text.contains("needs a Windows transport"), "{text}");
}

/// The line that would have settled the Windows question by itself.
#[test]
fn a_failed_dial_names_the_error_kind() {
    let directory = support::temp_dir();
    let path = directory.join("adapter.log");
    let (options, log) = options_logging_to(&path);
    let socket = directory.join("absent.sock");
    let mut client = Client::new(socket.to_str().unwrap(), "s3cret-token-value", options);
    assert!(client.connect(Duration::from_millis(500)).is_err());
    log.close();

    let text = fs::read_to_string(&path).expect("readable");
    assert!(text.contains("dial unix:"), "{text}");
    assert!(
        text.contains("dial failed, staying dormant: NotFound"),
        "{text}"
    );
    assert!(
        !text.contains("s3cret-token-value"),
        "the token reached the log:\n{text}"
    );
}

#[test]
fn a_silent_client_writes_nothing() {
    let directory = support::temp_dir();
    let socket = directory.join("absent.sock");
    let mut client = Client::new(
        socket.to_str().unwrap(),
        "token",
        Options::new("test", "0.0.0"),
    );
    assert!(client.connect(Duration::from_millis(200)).is_err());

    let entries: Vec<_> = fs::read_dir(&directory).expect("readable").collect();
    assert!(entries.is_empty(), "a client with no log left files behind");
}
