//! Conformance against `clients/test-vectors`, which is generated from the
//! normative TypeScript implementation. Every expectation here comes from
//! there: a divergence shows up as a failing test rather than silent drift.

use std::path::PathBuf;

use serde_json::value::RawValue;
use serde_json::Value;

use termwright_protocol::{
    encode_frame, encode_marker, marker::MARKER_MAC_BYTES, marker::MARKER_OSC_CODE,
    marker::MARKER_OSC_PREFIX, parse_adapter_message, parse_driver_message, roles::valid_action,
    roles::valid_capability, roles::valid_role, validate_snapshot, verify_marker_payload,
    FrameDecoder, Limits, ABSOLUTE_LIMITS, DEFAULT_LIMITS, FRAME_HEADER_BYTES, PROTOCOL_ID,
    PROTOCOL_VERSION,
};

fn vectors(name: &str) -> Value {
    let path: PathBuf = [
        env!("CARGO_MANIFEST_DIR"),
        "..",
        "test-vectors",
        &format!("{name}.json"),
    ]
    .iter()
    .collect();
    let body = std::fs::read_to_string(&path)
        .unwrap_or_else(|error| panic!("reading {}: {error}", path.display()));
    serde_json::from_str(&body).expect("vector file is valid JSON")
}

fn unhex(text: &str) -> Vec<u8> {
    assert!(text.len() % 2 == 0, "odd-length hex string");
    (0..text.len() / 2)
        .map(|index| u8::from_str_radix(&text[index * 2..index * 2 + 2], 16).expect("hex digit"))
        .collect()
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

// -- constants -------------------------------------------------------------

#[test]
fn constants_match_the_reference() {
    let vectors = vectors("constants");

    assert_eq!(vectors["protocolId"], PROTOCOL_ID);
    assert_eq!(vectors["protocolVersion"], PROTOCOL_VERSION);
    assert_eq!(vectors["frameHeaderBytes"], FRAME_HEADER_BYTES);
    assert_eq!(vectors["markerOscCode"], MARKER_OSC_CODE);
    assert_eq!(vectors["markerOscPrefix"], MARKER_OSC_PREFIX);
    assert_eq!(vectors["markerMacBytes"], MARKER_MAC_BYTES);

    let default_limits: Limits =
        serde_json::from_value(vectors["defaultLimits"].clone()).expect("limits shape");
    let absolute_limits: Limits =
        serde_json::from_value(vectors["absoluteLimits"].clone()).expect("limits shape");
    assert_eq!(default_limits, DEFAULT_LIMITS);
    assert_eq!(absolute_limits, ABSOLUTE_LIMITS);

    for role in vectors["roles"].as_array().expect("roles array") {
        assert!(valid_role(role.as_str().unwrap()), "unknown role {role}");
    }
    for action in vectors["actions"].as_array().expect("actions array") {
        assert!(
            valid_action(action.as_str().unwrap()),
            "unknown action {action}"
        );
    }
    for capability in vectors["capabilities"]
        .as_array()
        .expect("capabilities array")
    {
        assert!(
            valid_capability(capability.as_str().unwrap()),
            "unknown capability {capability}"
        );
    }
    assert_eq!(
        vectors["roles"].as_array().unwrap().len(),
        termwright_protocol::roles::SEMANTIC_ROLES.len()
    );

    assert_eq!(
        vectors["env"]["endpoint"],
        termwright_protocol::ENV_ENDPOINT
    );
    assert_eq!(vectors["env"]["token"], termwright_protocol::ENV_TOKEN);
    assert_eq!(
        vectors["env"]["protocol"],
        termwright_protocol::ENV_PROTOCOL
    );
}

// -- framing ---------------------------------------------------------------

#[test]
fn framing_encode_matches_reference_bytes() {
    let vectors = vectors("framing");
    let ceiling = vectors["maxFrameBytes"].as_u64().unwrap() as usize;

    for case in vectors["encode"].as_array().unwrap() {
        // The reference body is the canonical encoding; serde would order map
        // keys differently, so the body passes through and framing is what is
        // under test.
        let body: Box<RawValue> =
            serde_json::from_str(case["bodyJson"].as_str().unwrap()).expect("raw body");
        let frame = encode_frame(&body, ceiling).expect("encoding failed");
        assert_eq!(
            hex(&frame),
            case["frameHex"].as_str().unwrap(),
            "frame bytes differ for {}",
            case["name"]
        );
    }
}

#[test]
fn framing_decode_yields_reference_messages() {
    let vectors = vectors("framing");
    let ceiling = vectors["maxFrameBytes"].as_u64().unwrap() as usize;

    for case in vectors["decode"].as_array().unwrap() {
        let mut decoder = FrameDecoder::new(ceiling, DEFAULT_LIMITS.max_depth);
        let mut produced = Vec::new();
        for chunk in case["chunksHex"].as_array().unwrap() {
            let frames = decoder
                .push(&unhex(chunk.as_str().unwrap()))
                .expect("decoding failed");
            produced.extend(frames);
        }
        let expected = case["messages"].as_array().unwrap();
        assert_eq!(
            produced.len(),
            expected.len(),
            "frame count for {}",
            case["name"]
        );
        for (frame, want) in produced.iter().zip(expected) {
            assert_eq!(&frame.value, want, "frame body for {}", case["name"]);
        }
        assert_eq!(
            decoder.buffered(),
            0,
            "decoder held bytes after {}",
            case["name"]
        );
    }
}

#[test]
fn framing_rejects_hostile_frames() {
    let vectors = vectors("framing");
    let ceiling = vectors["maxFrameBytes"].as_u64().unwrap() as usize;

    for case in vectors["reject"].as_array().unwrap() {
        if case["optional"].as_bool().unwrap_or(false) {
            // serde_json replaces unpaired surrogates with U+FFFD before this
            // crate can see them, so the case is not detectable here.
            continue;
        }
        let mut decoder = FrameDecoder::new(ceiling, DEFAULT_LIMITS.max_depth);
        let error = decoder
            .push(&unhex(case["streamHex"].as_str().unwrap()))
            .expect_err(&format!("hostile frame {} was accepted", case["name"]));
        assert_eq!(
            error.code,
            case["code"].as_str().unwrap(),
            "code for {}",
            case["name"]
        );
    }
}

#[test]
fn a_failed_decoder_never_resumes() {
    let mut decoder = FrameDecoder::new(DEFAULT_LIMITS.max_frame_bytes, DEFAULT_LIMITS.max_depth);
    decoder
        .push(&[0, 0, 0, 0])
        .expect_err("zero-length frame was accepted");
    let frame = encode_frame(
        &serde_json::json!({"type": "revision-commit", "revision": 1}),
        DEFAULT_LIMITS.max_frame_bytes,
    )
    .expect("encoding");
    let error = decoder
        .push(&frame)
        .expect_err("poisoned decoder accepted input");
    assert_eq!(error.code, "decoder-poisoned");
}

#[test]
fn partial_frames_are_buffered() {
    let mut decoder = FrameDecoder::new(DEFAULT_LIMITS.max_frame_bytes, DEFAULT_LIMITS.max_depth);
    let frame = encode_frame(
        &serde_json::json!({"type": "revision-commit", "revision": 1}),
        DEFAULT_LIMITS.max_frame_bytes,
    )
    .expect("encoding");
    assert!(decoder
        .push(&frame[..frame.len() - 1])
        .expect("partial push")
        .is_empty());
    assert_eq!(decoder.buffered(), frame.len() - 1);
    assert_eq!(
        decoder
            .push(&frame[frame.len() - 1..])
            .expect("final byte")
            .len(),
        1
    );
}

// -- marker ----------------------------------------------------------------

#[test]
fn marker_vectors() {
    let vectors = vectors("marker");

    for case in vectors["encode"].as_array().unwrap() {
        let token = case["token"].as_str().unwrap();
        let session_id = case["sessionId"].as_str().unwrap();
        let revision = case["revision"].as_i64().unwrap();

        let sequence = encode_marker(token, session_id, revision).expect("encoding marker");
        assert_eq!(
            sequence,
            case["sequence"].as_str().unwrap(),
            "sequence for r{revision}"
        );
        assert_eq!(
            hex(sequence.as_bytes()),
            case["sequenceHex"].as_str().unwrap()
        );

        let marker = verify_marker_payload(case["payload"].as_str().unwrap(), token, session_id)
            .expect("reference marker did not verify");
        assert_eq!(marker.revision, revision);
        assert_eq!(marker.mac, case["mac"].as_str().unwrap());
    }

    // A parser strips the terminator; a regex over raw output keeps it. Both
    // must verify, and the normal path never exercises the second.
    for case in vectors["acceptTerminators"].as_array().unwrap() {
        let marker = verify_marker_payload(
            case["payload"].as_str().unwrap(),
            case["token"].as_str().unwrap(),
            case["sessionId"].as_str().unwrap(),
        )
        .unwrap_or_else(|| panic!("{} did not verify", case["name"]));
        assert_eq!(marker.revision, case["revision"].as_i64().unwrap());
    }

    for case in vectors["verifyReject"].as_array().unwrap() {
        let verified = verify_marker_payload(
            case["payload"].as_str().unwrap(),
            case["token"].as_str().unwrap(),
            case["sessionId"].as_str().unwrap(),
        );
        assert!(
            verified.is_none(),
            "forged marker {} verified",
            case["name"]
        );
    }
}

#[test]
fn marker_rejects_bad_arguments() {
    for revision in [0, -1, 1 << 54] {
        assert!(
            encode_marker("token", "session", revision).is_err(),
            "revision {revision}"
        );
    }
    assert!(encode_marker("", "session", 1).is_err(), "empty token");
    assert!(encode_marker("token", "", 1).is_err(), "empty session id");
}

#[test]
fn a_marker_does_not_verify_under_another_token() {
    let sequence = encode_marker("token-a", "s-1", 4).expect("encoding");
    // Only the introducer is stripped: verification tolerates the trailing
    // terminator, so leaving it on exercises that tolerance.
    let payload = sequence
        .strip_prefix(format!("\x1b]{MARKER_OSC_CODE};").as_str())
        .expect("an OSC introducer");
    assert!(verify_marker_payload(payload, "token-a", "s-1").is_some());
    assert!(verify_marker_payload(payload, "token-b", "s-1").is_none());
    assert!(verify_marker_payload(payload, "token-a", "s-2").is_none());
}

// -- snapshots -------------------------------------------------------------

#[test]
fn snapshot_vectors() {
    let vectors = vectors("snapshots");
    let limits: Limits = serde_json::from_value(vectors["limits"].clone()).expect("limits shape");
    assert_eq!(limits, DEFAULT_LIMITS);

    for case in vectors["accept"].as_array().unwrap() {
        validate_snapshot(&case["snapshot"], &limits)
            .unwrap_or_else(|error| panic!("valid snapshot {} rejected: {error}", case["name"]));
    }
    for case in vectors["reject"].as_array().unwrap() {
        let error = validate_snapshot(&case["snapshot"], &limits)
            .expect_err(&format!("invalid snapshot {} accepted", case["name"]));
        assert_eq!(
            error.code,
            case["code"].as_str().unwrap(),
            "code for {}: {error}",
            case["name"]
        );
    }
}

#[test]
fn snapshots_built_from_the_types_validate() {
    use termwright_protocol::{Action, Node, Rect, Role, Snapshot, State};

    let mut snapshot = Snapshot::new(80, 24);
    snapshot.session_id = "s-1".into();
    snapshot.revision = 1;
    snapshot.push(Node::new("root", Role::Application, "app"));
    snapshot.push(
        Node::new("ok", Role::Button, "OK")
            .with_parent("root")
            .with_bounds(Rect::new(1, 1, 4, 1))
            .with_state(State {
                focused: Some(true),
                ..State::default()
            })
            .with_actions(vec![Action::Focus, Action::Activate]),
    );

    let value = serde_json::to_value(&snapshot).expect("serialising");
    validate_snapshot(&value, &DEFAULT_LIMITS).expect("type-built snapshot rejected");
}

#[test]
fn deeply_nested_trees_are_rejected_by_depth() {
    use termwright_protocol::{Node, Role, Snapshot};

    let mut snapshot = Snapshot::new(80, 24);
    snapshot.session_id = "s-1".into();
    snapshot.revision = 1;
    snapshot.push(Node::new("n0", Role::Region, ""));
    for index in 1..=DEFAULT_LIMITS.max_depth {
        snapshot.push(
            Node::new(format!("n{index}"), Role::Region, "").with_parent(format!("n{}", index - 1)),
        );
    }

    let value = serde_json::to_value(&snapshot).expect("serialising");
    let error = validate_snapshot(&value, &DEFAULT_LIMITS).expect_err("deep tree accepted");
    assert_eq!(error.code, "depth");
}

// -- messages --------------------------------------------------------------

#[test]
fn message_vectors() {
    let vectors = vectors("messages");

    type Parser = fn(&Value, &Limits) -> Result<(), termwright_protocol::ParseError>;

    for (direction, parse) in [
        ("adapterToDriver", parse_adapter_message as Parser),
        ("driverToAdapter", parse_driver_message as Parser),
    ] {
        for case in vectors[direction]["accept"].as_array().unwrap() {
            parse(&case["message"], &DEFAULT_LIMITS).unwrap_or_else(|error| {
                panic!(
                    "valid {direction} message {} rejected: {error}",
                    case["name"]
                )
            });
        }
        for case in vectors[direction]["reject"].as_array().unwrap() {
            let error = parse(&case["message"], &DEFAULT_LIMITS).expect_err(&format!(
                "invalid {direction} message {} accepted",
                case["name"]
            ));
            assert_eq!(
                error.code,
                case["code"].as_str().unwrap(),
                "code for {direction}/{}: {error}",
                case["name"]
            );
        }
    }
}

// -- forward compatibility -------------------------------------------------

fn hello_ack_with(limits: Value, extra: Option<(&str, Value)>) -> Value {
    let mut ack = serde_json::json!({
        "type": "hello-ack",
        "protocol": PROTOCOL_ID,
        "sessionId": "s-1",
        "limits": limits,
        "subscribe": "snapshots",
        "marker": { "enabled": true },
    });
    if let Some((key, value)) = extra {
        ack[key] = value;
    }
    ack
}

/// `limits` is the one object on the wire that grows between versions. A
/// client that rejected a ceiling it had never heard of would close the
/// channel every time the protocol gained one.
#[test]
fn limits_tolerate_unknown_ceilings() {
    let mut limits = serde_json::to_value(DEFAULT_LIMITS).expect("limits serialise");
    limits["maxQuantumFlux"] = serde_json::json!(7);
    limits["maxTeaPots"] = serde_json::json!(1);

    let ack = hello_ack_with(limits.clone(), None);
    parse_driver_message(&ack, &DEFAULT_LIMITS)
        .expect("a forward-compatible hello-ack was rejected");

    // The unknown ceilings are ignored, not carried into the typed limits.
    let parsed: Limits = serde_json::from_value(limits).expect("unknown ceilings broke the decode");
    assert_eq!(parsed, DEFAULT_LIMITS);
}

#[test]
fn limits_still_require_every_known_ceiling() {
    let mut limits = serde_json::to_value(DEFAULT_LIMITS).expect("limits serialise");
    limits.as_object_mut().unwrap().remove("maxNodes");
    let error = parse_driver_message(&hello_ack_with(limits, None), &DEFAULT_LIMITS)
        .expect_err("a hello-ack missing a known ceiling was accepted");
    assert_eq!(error.code, "malformed");
}

/// Tolerance follows the speaker, not the message: a driver is the trusted
/// side and may grow its messages, so an adapter published today must survive
/// fields invented tomorrow. Adapter traffic crosses an untrusted boundary,
/// where an unknown field is a signal rather than an extension — and `error`
/// proves the point, being the same message read both ways.
#[test]
fn tolerance_follows_the_speaker_not_the_message() {
    let message = serde_json::json!({
        "type": "error", "code": "internal", "message": "boom", "trace": "…"
    });
    parse_driver_message(&message, &DEFAULT_LIMITS).expect("driver traffic was read strictly");
    assert!(
        parse_adapter_message(&message, &DEFAULT_LIMITS).is_err(),
        "adapter traffic was read tolerantly"
    );
}

/// Tolerance is not leniency: a vocabulary is not a growth point.
#[test]
fn closed_sets_stay_closed_in_both_directions() {
    let limits = serde_json::to_value(DEFAULT_LIMITS).expect("limits serialise");

    let mut unknown_subscribe = hello_ack_with(limits.clone(), None);
    unknown_subscribe["subscribe"] = serde_json::json!("everything");
    assert!(parse_driver_message(&unknown_subscribe, &DEFAULT_LIMITS).is_err());

    let mut unknown_type = hello_ack_with(limits.clone(), None);
    unknown_type["type"] = serde_json::json!("hello-ack-v2");
    assert!(parse_driver_message(&unknown_type, &DEFAULT_LIMITS).is_err());

    // Known fields keep their types even where unknown ones are tolerated.
    let bad_marker = hello_ack_with(
        limits,
        Some((
            "marker",
            serde_json::json!({ "enabled": "yes", "style": "dcs" }),
        )),
    );
    assert!(parse_driver_message(&bad_marker, &DEFAULT_LIMITS).is_err());
}

#[test]
fn the_optional_log_budget_is_understood() {
    let limits = serde_json::to_value(DEFAULT_LIMITS).expect("limits serialise");
    let budget = serde_json::json!({ "enabled": true, "maxRecordsPerSecond": 200, "burst": 50 });
    let ack = hello_ack_with(limits.clone(), Some(("logs", budget)));
    parse_driver_message(&ack, &DEFAULT_LIMITS).expect("a hello-ack carrying a log budget");

    let decoded: termwright_protocol::messages::HelloAck =
        serde_json::from_value(ack).expect("typed decode");
    let logs = decoded.logs.expect("the budget reached the typed message");
    assert_eq!(logs.max_records_per_second, 200);
    assert_eq!(logs.burst, 50);

    // A malformed budget is still a malformed message.
    let broken = serde_json::json!({ "enabled": true, "maxRecordsPerSecond": 0, "burst": 50 });
    assert!(parse_driver_message(
        &hello_ack_with(limits, Some(("logs", broken))),
        &DEFAULT_LIMITS
    )
    .is_err());
}

// -- the barrier against the next missing field -----------------------------

/// A field added to the protocol must fail here, not in production.
///
/// `frameworkType`, `occlusion`, `p` and `px` each reached the reference and
/// stayed unknown to this client until something tripped over a rejected
/// snapshot. The reference now exports its key list; this compares against it,
/// so the next one is a red test on the day it lands.
#[test]
fn node_and_state_keys_are_exactly_the_protocols() {
    use std::collections::BTreeSet;

    use termwright_protocol::schema_keys::{NODE_KEYS, STATE_KEYS};

    let constants = vectors("constants");
    for (what, expected, actual) in [
        ("node", &constants["nodeKeys"], &NODE_KEYS[..]),
        ("state", &constants["stateKeys"], &STATE_KEYS[..]),
    ] {
        let want: BTreeSet<String> = expected
            .as_array()
            .expect("the vector lists keys")
            .iter()
            .map(|value| value.as_str().expect("a key is a string").to_owned())
            .collect();
        let got: BTreeSet<String> = actual.iter().map(|key| (*key).to_owned()).collect();
        assert_eq!(
            want,
            got,
            "{what} keys diverged; missing here: {:?}, unknown to the protocol: {:?}",
            want.difference(&got).collect::<Vec<_>>(),
            got.difference(&want).collect::<Vec<_>>(),
        );
    }
}

/// The validator knowing a field is not the same as being able to send it.
///
/// Checked by serialising a node with every optional field populated and
/// reading back which keys survive: a field the struct cannot hold simply does
/// not appear, whatever the validator thinks.
#[test]
fn the_node_struct_can_carry_every_field() {
    use std::collections::{BTreeMap, BTreeSet};

    use termwright_protocol::{Node, Occlusion, Provenance, Rect, Role, State};

    let mut node = Node::new("n1", Role::Generic, "name");
    node.parent_id = Some("root".into());
    node.description = Some("described".into());
    node.value = Some(String::new());
    node.bounds = Some(Rect {
        row: 0,
        column: 0,
        width: 1,
        height: 1,
    });
    node.state = Some(State::default());
    node.actions = Some(vec![]);
    node.labelled_by = Some(vec!["a".into()]);
    node.described_by = Some(vec!["b".into()]);
    node.text_ranges = Some(vec![]);
    node.test_id = Some("t".into());
    node.framework_type = Some("Widget".into());
    node.occlusion = Some(Occlusion::Known);
    node.p = Some(Provenance::Framework);
    node.px = Some(BTreeMap::from([(
        "name".to_owned(),
        Provenance::Annotation,
    )]));

    let wire = serde_json::to_value(&node).expect("a node serialises");
    let carried: BTreeSet<&str> = wire
        .as_object()
        .expect("an object")
        .keys()
        .map(String::as_str)
        .collect();

    let constants = vectors("constants");
    for key in constants["nodeKeys"]
        .as_array()
        .expect("the vector lists keys")
    {
        let key = key.as_str().expect("a key is a string");
        assert!(
            carried.contains(key),
            "Node cannot carry {key:?}, so this client can never publish it",
        );
    }
}
