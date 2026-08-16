"""Log forwarding: the budget, the sequence gaps, and the logging bridge."""

from __future__ import annotations

import asyncio
import logging

import pytest
from conftest import load_vectors

from termwright import DEFAULT_LIMITS, LOG_LEVELS, MAX_LOG_ATTRS, flatten_attrs, validate_log_record
from termwright.client import CAPABILITIES_WITH_LOGS, ENV_ENDPOINT, ENV_TOKEN, SemanticClient
from termwright.logging_bridge import TermwrightLogHandler, install_log_handler, level_for
from termwright.logs import LogRecord

from test_client import SESSION, TOKEN, FakeDriver

CONSTANTS = load_vectors("constants")

BUDGET = {"enabled": True, "maxRecordsPerSecond": 100, "burst": 50}


async def connected_client(endpoint, logs=BUDGET):
    """A live client whose driver granted (or withheld) a log budget."""
    driver = FakeDriver(endpoint, logs=logs)
    await driver.start()
    client = SemanticClient(
        endpoint,
        TOKEN,
        adapter_name="pytest",
        adapter_version="0.1.0",
        capabilities=CAPABILITIES_WITH_LOGS,
    )
    assert await client.start(timeout=2.0) is True
    return driver, client


# -- the closed ladder -----------------------------------------------------


def test_levels_match_the_reference():
    assert list(LOG_LEVELS) == CONSTANTS["logLevels"]
    assert MAX_LOG_ATTRS == CONSTANTS["maxLogAttrs"]


@pytest.mark.parametrize(
    ("levelno", "expected"),
    [
        (logging.CRITICAL, "fatal"),
        (logging.ERROR, "error"),
        (logging.WARNING, "warn"),
        (logging.INFO, "info"),
        (logging.DEBUG, "debug"),
        (5, "trace"),  # below DEBUG: Python has no trace of its own
    ],
)
def test_python_levels_map_onto_the_wire_ladder(levelno, expected):
    assert level_for(levelno) == expected


# -- attribute flattening --------------------------------------------------


def test_nested_context_is_flattened_to_dotted_keys():
    """Nested attrs are rejected on the wire, so the bridge flattens first."""
    flat = flatten_attrs({"db": {"host": "localhost", "port": 5432}, "ok": True})
    assert flat == {"db.host": "localhost", "db.port": 5432, "ok": True}
    assert validate_log_record(
        LogRecord(ts=1, level="info", message="x", seq=0, attrs=flat).to_wire()
    ).ok


def test_values_that_are_not_scalars_survive_as_text():
    """Losing a value's shape beats dropping the record that carries it."""
    flat = flatten_attrs({"tags": ["a", "b"], "when": None})
    assert flat["when"] is None
    assert isinstance(flat["tags"], str)
    assert validate_log_record(
        LogRecord(ts=1, level="info", message="x", seq=0, attrs=flat).to_wire()
    ).ok


# -- the dormant and unbudgeted paths --------------------------------------


async def test_no_budget_means_no_logs(endpoint):
    """Absent `logs` in hello-ack means the adapter must stay silent."""
    driver, client = await connected_client(endpoint, logs=None)
    assert client.log_budget is None
    assert client.log("error", "should not be sent") is False
    await client.publish(_snapshot())
    await driver.wait_for(2)
    assert not [frame for frame in driver.received if frame["type"] == "log"]
    await client.close()
    await driver.close()


async def test_a_disabled_budget_is_also_silence(endpoint):
    driver, client = await connected_client(
        endpoint, logs={"enabled": False, "maxRecordsPerSecond": 100, "burst": 10}
    )
    assert client.log("error", "should not be sent") is False
    await client.close()
    await driver.close()


# -- the happy path --------------------------------------------------------


async def test_records_reach_the_driver_and_validate(endpoint):
    driver, client = await connected_client(endpoint)
    assert client.log("error", "connection refused", attrs={"db": {"host": "x"}}, logger="db.pool")
    await driver.wait_for(1)

    frames = [frame for frame in driver.received if frame["type"] == "log"]
    assert frames, "no log frame arrived"
    record = frames[0]["record"]
    result = validate_log_record(record, DEFAULT_LIMITS)
    assert result.ok, f"{result.code}: {result.detail}"
    assert record["level"] == "error"
    assert record["logger"] == "db.pool"
    assert record["attrs"] == {"db.host": "x"}
    assert record["ts"] > 1_600_000_000_000, "ts must be epoch milliseconds"

    await client.close()
    await driver.close()


async def test_sequence_numbers_are_dense_when_nothing_is_dropped(endpoint):
    driver, client = await connected_client(endpoint)
    for index in range(5):
        assert client.log("info", f"line {index}")
    await driver.wait_for(5)

    seqs = [frame["record"]["seq"] for frame in driver.received if frame["type"] == "log"]
    assert seqs == [1, 2, 3, 4, 5]

    await client.close()
    await driver.close()


# -- dropping, and the gap it leaves ---------------------------------------


async def test_going_over_budget_drops_locally_and_leaves_a_gap(endpoint):
    """The gap in seq is how the driver learns records died here, not in transit.

    A burst is spent, the rest of the burst-worth is dropped, and then the
    bucket refills — so the delivered stream carries a hole in the middle,
    which is the shape the driver keys on. Renumbering after a drop would hide
    exactly the loss the counter exists to report.
    """
    driver, client = await connected_client(
        endpoint, logs={"enabled": True, "maxRecordsPerSecond": 20, "burst": 2}
    )

    delivered = sum(client.log("info", f"burst {index}") for index in range(40))
    assert delivered < 40, "the rate limit never engaged"
    assert client.logs_dropped == 40 - delivered

    await asyncio.sleep(0.3)  # let the bucket refill
    assert client.log("info", "after the refill")

    await driver.wait_for(delivered + 1)
    seqs = [frame["record"]["seq"] for frame in driver.received if frame["type"] == "log"]
    assert seqs == sorted(seqs), "sequence numbers must not go backwards"
    assert len(set(seqs)) == len(seqs), "sequence numbers must not repeat"
    assert max(seqs) > len(seqs), "a drop must consume its number rather than renumber"
    assert seqs[-1] == 41, "the record after the refill keeps counting from the attempts"

    await client.close()
    await driver.close()


async def test_an_oversized_record_is_dropped_not_sent(endpoint):
    driver, client = await connected_client(endpoint)
    assert client.log("info", "x" * (DEFAULT_LIMITS.maxLogRecordBytes + 10)) is False
    assert client.logs_dropped == 1

    assert client.log("info", "small enough")
    await driver.wait_for(1)
    frames = [frame for frame in driver.received if frame["type"] == "log"]
    assert len(frames) == 1
    assert frames[0]["record"]["seq"] == 2, "the dropped record still consumed its number"

    await client.close()
    await driver.close()


# -- the logging bridge ----------------------------------------------------


async def test_the_handler_forwards_what_the_application_already_logs(endpoint):
    driver, client = await connected_client(endpoint)
    logger = logging.getLogger("test.bridge")
    logger.setLevel(logging.DEBUG)
    logger.propagate = False
    handler = install_log_handler(client, logger)
    assert isinstance(handler, TermwrightLogHandler)

    try:
        logger.error("disk almost full", extra={"free_bytes": 512, "mount": {"path": "/"}})
        await driver.wait_for(1)
    finally:
        logger.removeHandler(handler)

    record = [frame for frame in driver.received if frame["type"] == "log"][0]["record"]
    assert record["level"] == "error"
    assert record["message"] == "disk almost full"
    assert record["logger"] == "test.bridge"
    assert record["attrs"] == {"free_bytes": 512, "mount.path": "/"}
    assert validate_log_record(record, DEFAULT_LIMITS).ok

    await client.close()
    await driver.close()


async def test_the_handler_reports_an_exception_by_type(endpoint):
    driver, client = await connected_client(endpoint)
    logger = logging.getLogger("test.exceptions")
    logger.propagate = False
    handler = install_log_handler(client, logger)
    try:
        try:
            raise ValueError("nope")
        except ValueError:
            logger.exception("failed to parse")
        await driver.wait_for(1)
    finally:
        logger.removeHandler(handler)

    record = [frame for frame in driver.received if frame["type"] == "log"][0]["record"]
    assert record["attrs"]["exception"] == "ValueError"

    await client.close()
    await driver.close()


def test_installing_without_a_client_is_a_no_op(monkeypatch):
    """The dormant path: an app may call this unconditionally."""
    monkeypatch.delenv(ENV_ENDPOINT, raising=False)
    monkeypatch.delenv(ENV_TOKEN, raising=False)
    logger = logging.getLogger("test.dormant")
    before = list(logger.handlers)
    assert install_log_handler(None, logger) is None
    assert logger.handlers == before


def _snapshot():
    from termwright.tree import Rect, SemanticNode, SemanticSnapshot

    return SemanticSnapshot(
        sessionId="ignored",
        revision=0,
        columns=80,
        rows=24,
        rootIds=["root"],
        nodes=[SemanticNode(id="root", role="application", name="app", bounds=Rect(0, 0, 10, 1))],
    )
