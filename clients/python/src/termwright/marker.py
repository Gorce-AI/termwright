"""Render-commit marker.

The adapter writes this DCS sequence to stdout *after* the last byte of the
render belonging to revision N. It is a frame-commit signal, never a data
carrier::

    ESC P twm;<revision>;<mac> ESC \\

with ``mac = base64url(HMAC-SHA256(token, f"{session_id}:{revision}"))[:16]``,
unpadded. The token is an opaque UTF-8 string end to end: whatever arrives in
``TERMWRIGHT_TOKEN`` is fed to the HMAC as key bytes, never re-decoded.
"""

from __future__ import annotations

import base64
import hmac
import re
from dataclasses import dataclass
from hashlib import sha256
from typing import Optional

from .errors import ProtocolViolation

MARKER_DCS_PREFIX = "twm;"
MARKER_DCS_FINAL = "t"
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
    return f"\x1bP{MARKER_DCS_PREFIX}{revision};{mac}\x1b\\"


def verify_marker_payload(payload: str, token: str, session_id: str) -> Optional[RenderMarker]:
    """Parse and verify a DCS payload (the bytes between ``ESC P`` and ``ESC \\``).

    Total function: hostile payloads return ``None``, never raise. Only
    canonically formatted revisions are accepted, so ``1`` and ``01`` cannot
    both authenticate the same commit, and the MAC compare is constant-time.
    """
    if not token or not session_id:
        return None
    if not payload.startswith(MARKER_DCS_PREFIX):
        return None

    body = payload[len(MARKER_DCS_PREFIX) :]
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
