//! Error types shared by the protocol modules.

use std::fmt;

/// Untrusted input broke a wire invariant.
///
/// `code` mirrors the reference implementation's `ProtocolViolation.code`, so
/// the cross-language vectors can assert on it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Violation {
    /// Stable machine-readable code, e.g. `frame-oversized`.
    pub code: &'static str,
    /// Human-readable detail. Never contains the session token.
    pub detail: String,
}

impl Violation {
    pub(crate) fn new(code: &'static str, detail: impl Into<String>) -> Self {
        Self {
            code,
            detail: detail.into(),
        }
    }
}

impl fmt::Display for Violation {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "{}: {}", self.code, self.detail)
    }
}

impl std::error::Error for Violation {}

/// Why a snapshot was refused.
///
/// `code` is the shared taxonomy: `schema`, `unknown-role`, `duplicate-id`,
/// `missing-parent`, `cycle`, `depth`, `count`, `string-bytes`, `bad-rect`,
/// `revision`, `bytes`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ValidationError {
    /// Stable machine-readable code.
    pub code: &'static str,
    /// Human-readable detail, prefixed with the offending path where known.
    pub detail: String,
}

impl ValidationError {
    pub(crate) fn new(code: &'static str, detail: impl Into<String>) -> Self {
        Self {
            code,
            detail: detail.into(),
        }
    }
}

impl fmt::Display for ValidationError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "{}: {}", self.code, self.detail)
    }
}

impl std::error::Error for ValidationError {}

/// Why a wire message was refused: `bad-version`, `malformed` or
/// `limit-exceeded`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParseError {
    /// One of the three wire error codes.
    pub code: &'static str,
    /// Human-readable detail.
    pub detail: String,
}

impl ParseError {
    pub(crate) fn new(code: &'static str, detail: impl Into<String>) -> Self {
        Self {
            code,
            detail: detail.into(),
        }
    }

    pub(crate) fn malformed(detail: impl Into<String>) -> Self {
        Self::new("malformed", detail)
    }
}

impl fmt::Display for ParseError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "{}: {}", self.code, self.detail)
    }
}

impl std::error::Error for ParseError {}

/// Anything that can go wrong while running a session.
#[derive(Debug)]
pub enum Error {
    /// The wire contract was broken.
    Protocol(Violation),
    /// A snapshot failed validation before it was sent.
    Validation(ValidationError),
    /// An incoming message could not be parsed.
    Parse(ParseError),
    /// The transport failed.
    Io(std::io::Error),
    /// The driver did not answer the handshake in time.
    HandshakeTimeout,
}

impl fmt::Display for Error {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Error::Protocol(inner) => write!(formatter, "{inner}"),
            Error::Validation(inner) => write!(formatter, "{inner}"),
            Error::Parse(inner) => write!(formatter, "{inner}"),
            Error::Io(inner) => write!(formatter, "io: {inner}"),
            Error::HandshakeTimeout => write!(formatter, "timed out waiting for hello-ack"),
        }
    }
}

impl std::error::Error for Error {}

impl From<Violation> for Error {
    fn from(inner: Violation) -> Self {
        Error::Protocol(inner)
    }
}

impl From<ValidationError> for Error {
    fn from(inner: ValidationError) -> Self {
        Error::Validation(inner)
    }
}

impl From<ParseError> for Error {
    fn from(inner: ParseError) -> Self {
        Error::Parse(inner)
    }
}

impl From<std::io::Error> for Error {
    fn from(inner: std::io::Error) -> Self {
        Error::Io(inner)
    }
}
