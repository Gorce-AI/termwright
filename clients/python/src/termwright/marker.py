"""Render-commit marker.

The adapter writes this OSC sequence to stdout *after* the last byte of the
render belonging to revision N. It is a frame-commit signal, never a data
carrier::

    OSC 8487 ; twm;<revision>;<mac> BEL

with ``mac = base64url(HMAC-SHA256(token, f"{session_id}:{revision}"))[:16]``,
unpadded. The token is an opaque UTF-8 string end to end: whatever arrives in
``TERMWRIGHT_TOKEN`` is fed to the HMAC as key bytes, never re-decoded.

The legacy frame-based inbox ConPTY dropped DCS, APC and OSC 8 while private
OSC survived. Termwright's pinned passthrough ConPTY now forwards those
families, but OSC 8487 remains the single encoding certified across every
supported host. One encoding everywhere avoids a second causal protocol.
"""

from __future__ import annotations

import base64
import hmac
import re
from dataclasses import dataclass
from hashlib import sha256
from typing import Optional

from .errors import ProtocolViolation

#: The private OSC number carrying render-commit markers. Chosen clear of
#: everything in use (xterm's allocations, OSC 8, 9, 99, 133, 633, 697, 777+):
#: 84 and 87 are the ASCII codes of ``T`` and ``W``, for termwright.
MARKER_OSC_CODE = 8487

#: The tag opening a marker payload, immediately after ``OSC 8487;``. Kept as a
#: self-identifying guard: if anything ever claims 8487, a marker still says
#: what it is instead of being mistaken for that feature's payload.
MARKER_OSC_PREFIX = "twm;"

#: The terminator this implementation emits — the one ConPTY was observed to
#: forward most reliably.
BEL = "\x07"

#: The terminator a receiver must also accept.
ST = "\x1b\\"
MARKER_MAC_BYTES = 16
MARKER_MAC_CHARS = 22

_MAX_SAFE_INTEGER = 2**53 - 1

_REVISION_TEXT = re.compile(r"^[1-9][0-9]{0,15}$")
_MAC_TEXT = re.compile(r"^[A-Za-z0-9_-]{%d}$" % MARKER_MAC_CHARS)


@dataclass(frozen=True)
class RenderMarker:
    """A verified marker: the revision it commits and the MAC that proved it."""

    revision: int
    mac: str


def compute_mac(token: str, session_id: str, revision: int) -> str:
    """Return the unpadded base64url MAC bound to ``session_id`` and ``revision``."""
    digest = hmac.new(
        token.encode("utf-8"), f"{session_id}:{revision}".encode("utf-8"), sha256
    ).digest()
    return base64.urlsafe_b64encode(digest[:MARKER_MAC_BYTES]).decode("ascii").rstrip("=")


def encode_marker(token: str, session_id: str, revision: int) -> str:
    """Build the full escape sequence committing ``revision``.

    :raises ProtocolViolation: On an empty token/session id or a revision that
        is not a positive safe integer.
    """
    if not token:
        raise ProtocolViolation("marker-argument", "token must not be empty")
    if not session_id:
        raise ProtocolViolation("marker-argument", "sessionId must not be empty")
    if isinstance(revision, bool) or not isinstance(revision, int):
        raise ProtocolViolation("marker-argument", "revision must be a positive safe integer")
    if revision <= 0 or revision > _MAX_SAFE_INTEGER:
        raise ProtocolViolation("marker-argument", "revision must be a positive safe integer")
    mac = compute_mac(token, session_id, revision)
    return f"\x1b]{MARKER_OSC_CODE};{MARKER_OSC_PREFIX}{revision};{mac}{BEL}"


def verify_marker_payload(payload: str, token: str, session_id: str) -> Optional[RenderMarker]:
    """Parse and verify an OSC payload — everything after ``OSC 8487;``.

    Total function: hostile payloads return ``None``, never raise. Only
    canonically formatted revisions are accepted, so ``1`` and ``01`` cannot
    both authenticate the same commit, and the MAC compare is constant-time.

    A trailing BEL or ST is tolerated: a VT parser consumes the terminator
    before dispatching, so a handler normally passes a payload without one,
    while a caller scanning raw output with a regex keeps it. Both must work.
    """
    if not token or not session_id:
        return None

    text = payload
    if text.endswith(BEL):
        text = text[: -len(BEL)]
    elif text.endswith(ST):
        text = text[: -len(ST)]

    if not text.startswith(MARKER_OSC_PREFIX):
        return None

    body = text[len(MARKER_OSC_PREFIX) :]
    separator = body.find(";")
    if separator < 0:
        return None

    revision_text = body[:separator]
    mac = body[separator + 1 :]
    if not _REVISION_TEXT.match(revision_text) or not _MAC_TEXT.match(mac):
        return None

    revision = int(revision_text)
    if revision <= 0 or revision > _MAX_SAFE_INTEGER:
        return None
    if not hmac.compare_digest(compute_mac(token, session_id, revision), mac):
        return None
    return RenderMarker(revision=revision, mac=mac)
