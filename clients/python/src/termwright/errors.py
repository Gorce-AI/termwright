"""Error types shared by the protocol modules."""

from __future__ import annotations


class TermwrightError(Exception):
    """Base class for every error raised across this package's public surface."""


class ProtocolViolation(TermwrightError):
    """Untrusted input broke a wire invariant.

    ``code`` mirrors the reference implementation's ``ProtocolViolation.code``
    so the cross-language vectors can assert on it.
    """

    def __init__(self, code: str, message: str) -> None:
        super().__init__(f"{code}: {message}")
        self.code = code
        self.detail = message
