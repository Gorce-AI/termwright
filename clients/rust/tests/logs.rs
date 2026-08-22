#![cfg(unix)]

//! Log forwarding: the budget, the sequence gaps, and the tracing bridge.

mod support;

use std::time::Duration;

use serde_json::{json, Value};

use termwright_protocol::logs::{validate_log_record, AttrValue, LogLevel, LogRecord, LOG_LEVELS};
use termwright_protocol::{Client, Options, DEFAULT_LIMITS, MAX_LOG_ATTRS};

use support::{records_from, start_fake_driver, TOKEN};

fn budget(per_second: i64, burst: i64) -> Value {
    json!({ "enabled": true, "maxRecordsPerSecond": per_second, "burst": burst })
}

/// A live client whose driver granted (or withheld) a log budget.
fn connected(path: &str, logs: Option<Value>) -> (support::Driver, Client) {
    let driver = start_fake_driver(path, logs);
    let mut client = Client::new(path, TOKEN, Options::with_logs("rust-test", "0.1.0"));
    client.connect(Duration::from_secs(2)).expect("handshake");
    (driver, client)
}

// -- the closed ladder -----------------------------------------------------

#[test]
fn the_ladder_matches_the_reference() {
    let constants = support::vectors("constants");
    let levels: Vec<String> = constants["logLevels"]
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v.as_str().unwrap().to_owned())
        .collect();
    assert_eq!(levels, LOG_LEVELS);
    assert_eq!(
        constants["maxLogAttrs"].as_u64().unwrap() as usize,
        MAX_LOG_ATTRS
    );

    for (level, name) in [
        (LogLevel::Trace, "trace"),
        (LogLevel::Debug, "debug"),
        (LogLevel::Info, "info"),
        (LogLevel::Warn, "warn"),
        (LogLevel::Error, "error"),
        (LogLevel::Fatal, "fatal"),
    ] {
        assert_eq!(level.as_str(), name);
        let severity = constants["logLevelSeverity"][name].as_u64().unwrap();
        assert_eq!(u64::from(level.severity()), severity);
    }
}

#[test]
fn a_built_record_validates() {
    let record = LogRecord::new(LogLevel::Error, "connection refused")
        .with_logger("db.pool")
        .with_attr("db.host", "localhost")
        .with_attr("db.port", 5432i64)
        .with_attr("retrying", true);
    let mut record = record;
    record.ts = 1_755_300_000_000;
    record.seq = 1;
    record
        .validate(&DEFAULT_LIMITS)
        .expect("a hand-built record was rejected");
}

#[test]
fn a_non_finite_attribute_degrades_to_text_rather_than_breaking_the_record() {
    // Losing a value's shape beats dropping the record that carries it.
    assert!(matches!(AttrValue::from(f64::NAN), AttrValue::Text(_)));
    let mut record = LogRecord::new(LogLevel::Info, "x").with_attr("ratio", f64::INFINITY);
    record.ts = 1;
    record.seq = 0;
    record
        .validate(&DEFAULT_LIMITS)
        .expect("a degraded attribute broke the record");
}

// -- the dormant and unbudgeted paths --------------------------------------

#[test]
fn no_budget_means_no_logs() {
    let path = support::socket_path();
    let (_driver, mut client) = connected(&path, None);
    assert!(client.log_budget().is_none());
    assert!(!client.log(LogRecord::new(LogLevel::Error, "should not be sent")));
    let _ = std::fs::remove_file(&path);
}

#[test]
fn a_disabled_budget_is_also_silence() {
    let path = support::socket_path();
    let (_driver, mut client) = connected(
        &path,
        Some(json!({ "enabled": false, "maxRecordsPerSecond": 100, "burst": 10 })),
    );
    assert!(!client.log(LogRecord::new(LogLevel::Error, "should not be sent")));
    let _ = std::fs::remove_file(&path);
}

// -- the happy path --------------------------------------------------------

#[test]
fn records_reach_the_driver_and_validate() {
    let path = support::socket_path();
    let (driver, mut client) = connected(&path, Some(budget(100, 50)));

    assert!(client.log(
        LogRecord::new(LogLevel::Error, "connection refused")
            .with_logger("db.pool")
            .with_attr("db.host", "localhost")
    ));

    let records = records_from(&driver, 1);
    validate_log_record(&records[0], &DEFAULT_LIMITS).expect("the published record is invalid");
    assert_eq!(records[0]["level"], "error");
    assert_eq!(records[0]["logger"], "db.pool");
    assert_eq!(records[0]["attrs"]["db.host"], "localhost");
    assert!(
        records[0]["ts"].as_i64().unwrap() > 1_600_000_000_000,
        "ts must be epoch milliseconds"
    );

    let _ = std::fs::remove_file(&path);
}

#[test]
fn sequence_numbers_are_dense_when_nothing_is_dropped() {
    let path = support::socket_path();
    let (driver, mut client) = connected(&path, Some(budget(100, 50)));
    for index in 0..5 {
        assert!(client.log(LogRecord::new(LogLevel::Info, format!("line {index}"))));
    }
    let records = records_from(&driver, 5);
    let seqs: Vec<i64> = records.iter().map(|r| r["seq"].as_i64().unwrap()).collect();
    assert_eq!(seqs, vec![1, 2, 3, 4, 5]);
    let _ = std::fs::remove_file(&path);
}

// -- dropping, and the gap it leaves ---------------------------------------

/// The gap in `seq` is how the driver learns records died here rather than in
/// transit. Renumbering after a drop would hide exactly the loss the counter
/// exists to report.
#[test]
fn going_over_budget_drops_locally_and_leaves_a_gap() {
    let path = support::socket_path();
    let (driver, mut client) = connected(&path, Some(budget(20, 2)));

    let delivered = (0..40)
        .filter(|index| client.log(LogRecord::new(LogLevel::Info, format!("burst {index}"))))
        .count();
    assert!(delivered < 40, "the rate limit never engaged");
    assert_eq!(client.logs_dropped(), (40 - delivered) as u64);

    std::thread::sleep(Duration::from_millis(300)); // let the bucket refill
    assert!(client.log(LogRecord::new(LogLevel::Info, "after the refill")));

    let records = records_from(&driver, delivered + 1);
    let seqs: Vec<i64> = records.iter().map(|r| r["seq"].as_i64().unwrap()).collect();
    let mut sorted = seqs.clone();
    sorted.sort_unstable();
    sorted.dedup();
    assert_eq!(
        seqs, sorted,
        "sequence numbers must not repeat or go backwards"
    );
    assert!(
        *seqs.last().unwrap() > seqs.len() as i64,
        "a drop must consume its number rather than renumber"
    );
    assert_eq!(*seqs.last().unwrap(), 41);

    let _ = std::fs::remove_file(&path);
}

#[test]
fn an_oversized_record_is_dropped_not_sent() {
    let path = support::socket_path();
    let (driver, mut client) = connected(&path, Some(budget(100, 50)));

    let huge = "x".repeat(DEFAULT_LIMITS.max_log_record_bytes + 10);
    assert!(!client.log(LogRecord::new(LogLevel::Info, huge)));
    assert_eq!(client.logs_dropped(), 1);

    assert!(client.log(LogRecord::new(LogLevel::Info, "small enough")));
    let records = records_from(&driver, 1);
    assert_eq!(records.len(), 1);
    assert_eq!(
        records[0]["seq"], 2,
        "the dropped record still consumed its number"
    );

    let _ = std::fs::remove_file(&path);
}

// -- the tracing bridge ----------------------------------------------------

#[cfg(feature = "tracing")]
#[test]
fn the_layer_forwards_what_the_application_already_traces() {
    use std::sync::{Arc, Mutex};
    use termwright_protocol::tracing_layer::TermwrightLayer;
    use tracing_subscriber::prelude::*;

    let path = support::socket_path();
    let (driver, client) = connected(&path, Some(budget(100, 50)));
    let shared = Arc::new(Mutex::new(client));

    let subscriber = tracing_subscriber::registry().with(TermwrightLayer::new(shared.clone()));
    tracing::subscriber::with_default(subscriber, || {
        tracing::error!(free_bytes = 512, mount = "/", "disk almost full");
    });

    let records = records_from(&driver, 1);
    assert_eq!(records[0]["level"], "error");
    assert_eq!(records[0]["message"], "disk almost full");
    assert_eq!(records[0]["attrs"]["free_bytes"], 512);
    assert_eq!(records[0]["attrs"]["mount"], "/");
    validate_log_record(&records[0], &DEFAULT_LIMITS).expect("the bridged record is invalid");

    let _ = std::fs::remove_file(&path);
}

#[cfg(feature = "tracing")]
#[test]
fn tracing_levels_map_onto_the_wire_ladder() {
    use termwright_protocol::tracing_layer::level_for;
    assert_eq!(level_for(&tracing::Level::TRACE), LogLevel::Trace);
    assert_eq!(level_for(&tracing::Level::DEBUG), LogLevel::Debug);
    assert_eq!(level_for(&tracing::Level::INFO), LogLevel::Info);
    assert_eq!(level_for(&tracing::Level::WARN), LogLevel::Warn);
    assert_eq!(level_for(&tracing::Level::ERROR), LogLevel::Error);
}

// -- who owns the sequence number ------------------------------------------

/// The channel is open to several publishers, and two of them can pick the
/// same number in good faith. The adapter restamps, so what reaches the driver
/// is strictly increasing however badly the publishers collide — and the
/// publisher's own number survives as a diagnostic, not as a promise.
#[test]
fn the_adapter_owns_the_sequence_number() {
    let path = support::socket_path();
    let (driver, mut client) = connected(&path, Some(budget(100, 50)));

    for origin in [7i64, 7, 3] {
        let mut record = LogRecord::new(LogLevel::Info, "collide");
        record.seq = origin;
        assert!(
            client.log(record),
            "the record carrying origin {origin} was dropped"
        );
    }

    let records = records_from(&driver, 3);
    let seqs: Vec<i64> = records.iter().map(|r| r["seq"].as_i64().unwrap()).collect();
    assert!(
        seqs.windows(2).all(|pair| pair[0] < pair[1]),
        "not strictly increasing: {seqs:?}"
    );
    for (record, origin) in records.iter().zip([7, 7, 3]) {
        assert_eq!(
            record["attrs"]["origin.seq"], origin,
            "the publisher's number was lost"
        );
    }

    let _ = std::fs::remove_file(&path);
}

/// Everything is published under one colliding number, so a gap in what
/// arrives can only have come from the adapter's own counter.
#[test]
fn a_rate_limited_run_gaps_on_the_adapters_counter() {
    let path = support::socket_path();
    let (driver, mut client) = connected(&path, Some(budget(20, 2)));

    let delivered = (0..40)
        .filter(|_| {
            let mut record = LogRecord::new(LogLevel::Info, "burst");
            record.seq = 1;
            client.log(record)
        })
        .count();
    assert!(delivered < 40, "the rate limit never engaged");

    // A drop at the very end is invisible until something later arrives, so
    // the gap is only assertable once the bucket has refilled.
    std::thread::sleep(Duration::from_millis(300));
    let mut later = LogRecord::new(LogLevel::Info, "after the refill");
    later.seq = 1;
    assert!(client.log(later));

    let records = records_from(&driver, delivered + 1);
    let last = records.last().unwrap()["seq"].as_i64().unwrap();
    assert!(
        last > records.len() as i64,
        "last seq {last} with {} records: the gap did not come from the adapter",
        records.len()
    );
    assert_eq!(last, 41);

    let _ = std::fs::remove_file(&path);
}

/// The hint is dropped rather than allowed to push a record past a limit.
#[test]
fn origin_seq_is_skipped_at_the_attribute_ceiling() {
    let path = support::socket_path();
    let (driver, mut client) = connected(&path, Some(budget(100, 50)));

    let mut record = LogRecord::new(LogLevel::Info, "wide");
    record.seq = 9;
    for index in 0..MAX_LOG_ATTRS {
        record
            .attrs
            .insert(format!("k{index}"), AttrValue::Int(index as i64));
    }
    assert!(
        client.log(record),
        "a record at the attribute ceiling was dropped"
    );

    let records = records_from(&driver, 1);
    let attrs = records[0]["attrs"].as_object().unwrap();
    assert_eq!(attrs.len(), MAX_LOG_ATTRS);
    assert!(
        !attrs.contains_key("origin.seq"),
        "the hint was added on top of a full set"
    );
    validate_log_record(&records[0], &DEFAULT_LIMITS).expect("the published record is invalid");

    let _ = std::fs::remove_file(&path);
}
