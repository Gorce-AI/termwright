//! Turning a pristine `ratatui-core` into the instrumented copy, reproducibly.
//!
//! The patch set is deliberately tiny: one call inserted into
//! `Frame::render_widget`, and one dependency added to `Cargo.toml`. Everything
//! that reads state or opens a socket lives in this crate instead, so a new
//! Ratatui release usually moves the anchor rather than invalidating the
//! instrumentation.
//!
//! Checksums are the point of the manifest. A patch applied to the wrong
//! version fails somewhere inside a diff context and reports a line number; a
//! checksum failure reports *what the file is*, which is the sentence a user
//! can act on. Both states are pinned, so a copy that applied cleanly and
//! produced something unexpected is caught too.
//!
//! One thing the manifest cannot carry is the path to this crate: it differs
//! per machine, so a static patch file would be wrong everywhere but where it
//! was written. The manifest declares the requirement and the applier writes
//! the resolved path in, which is what the Go probe's generated workspace does
//! for its module.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::process::Command;

/// One file the patch set edits in place.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PatchedFile {
    pub path: String,
    pub patch: String,
    pub sha256_before: String,
    pub sha256_after: String,
}

/// What a patch set declares about itself.
#[derive(Debug, Clone)]
pub struct PatchManifest {
    pub framework: String,
    pub framework_version: String,
    pub patch_set_version: u32,
    pub patched: Vec<PatchedFile>,
}

/// Failures a user can act on, each naming what is actually wrong.
#[derive(Debug)]
pub enum PatchError {
    /// The file on disk is not the version this patch set was written for.
    VersionMismatch {
        path: String,
        expected: String,
        found: String,
    },
    /// The patch applied, and produced something other than what was pinned.
    UnexpectedResult {
        path: String,
        expected: String,
        found: String,
    },
    /// `patch` or `git apply` refused the diff.
    ApplyFailed {
        path: String,
        detail: String,
    },
    /// The manifest could not be read or understood.
    ManifestInvalid(String),
    Io(io::Error),
}

impl std::fmt::Display for PatchError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::VersionMismatch {
                path,
                expected,
                found,
            } => write!(
                formatter,
                "{path} is not the file this patch set was written for \
                 (expected {expected}, found {found}); the framework version \
                 probably moved"
            ),
            Self::UnexpectedResult {
                path,
                expected,
                found,
            } => write!(
                formatter,
                "{path} applied cleanly but produced {found}, not {expected}; \
                 the patch and the manifest disagree"
            ),
            Self::ApplyFailed { path, detail } => {
                write!(formatter, "applying the patch for {path} failed: {detail}")
            }
            Self::ManifestInvalid(detail) => write!(formatter, "manifest is unusable: {detail}"),
            Self::Io(error) => write!(formatter, "io: {error}"),
        }
    }
}

impl std::error::Error for PatchError {}

impl From<io::Error> for PatchError {
    fn from(error: io::Error) -> Self {
        Self::Io(error)
    }
}

/// `sha256:<hex>` of a file's bytes.
///
/// Hand-rolled rather than pulled from a crate: this is the only hash the
/// probe computes, and the dependency would follow the patched framework into
/// every instrumented user's build.
pub fn digest_file(path: &Path) -> Result<String, PatchError> {
    Ok(format!("sha256:{}", sha256_hex(&fs::read(path)?)))
}

/// Read a manifest written by the generator.
///
/// Parsed by hand for the same reason the hash is: a JSON crate here would
/// become a dependency of the patched framework's build.
pub fn read_manifest(path: &Path) -> Result<PatchManifest, PatchError> {
    let text = fs::read_to_string(path)?;
    let value = json::parse(&text).map_err(PatchError::ManifestInvalid)?;
    let framework = value.string("framework")?;
    let framework_version = value.string("frameworkVersion")?;
    let patch_set_version = value.number("patchSetVersion")? as u32;
    let mut patched = Vec::new();
    for entry in value.array("patched")? {
        patched.push(PatchedFile {
            path: entry.string("path")?,
            patch: entry.string("patch")?,
            sha256_before: entry.string("sha256Before")?,
            sha256_after: entry.string("sha256After")?,
        });
    }
    Ok(PatchManifest {
        framework,
        framework_version,
        patch_set_version,
        patched,
    })
}

/// Apply the patch set to a writable copy of the framework.
///
/// `probe_path` is written into the copy's `Cargo.toml` as the location of
/// this crate; see the module docs for why it cannot be in the patch.
pub fn apply(
    manifest: &PatchManifest,
    patch_set_dir: &Path,
    copy: &Path,
    probe_path: &Path,
) -> Result<(), PatchError> {
    for file in &manifest.patched {
        let target = copy.join(&file.path);
        let before = digest_file(&target)?;
        if before != file.sha256_before {
            return Err(PatchError::VersionMismatch {
                path: file.path.clone(),
                expected: file.sha256_before.clone(),
                found: before,
            });
        }
    }

    for file in &manifest.patched {
        let patch = patch_set_dir.join(&file.patch);
        let output = Command::new("patch")
            .arg("-p1")
            .arg("--input")
            .arg(&patch)
            .current_dir(copy)
            .output()?;
        if !output.status.success() {
            return Err(PatchError::ApplyFailed {
                path: file.path.clone(),
                detail: String::from_utf8_lossy(&output.stderr).trim().to_owned(),
            });
        }
    }

    for file in &manifest.patched {
        let target = copy.join(&file.path);
        let after = digest_file(&target)?;
        if after != file.sha256_after {
            return Err(PatchError::UnexpectedResult {
                path: file.path.clone(),
                expected: file.sha256_after.clone(),
                found: after,
            });
        }
    }

    supply_probe_path(copy, probe_path)
}

/// Point the copy's dependency on this crate at where it actually is.
///
/// Done after the checksums are verified, so the pinned "after" state is the
/// machine-independent one and every copy is checked against the same value.
fn supply_probe_path(copy: &Path, probe_path: &Path) -> Result<(), PatchError> {
    let manifest = copy.join("Cargo.toml");
    let text = fs::read_to_string(&manifest)?;
    let anchor = "[dependencies.termwright-probe-ratatui]\nversion = \"0.1.0\"";
    if !text.contains(anchor) {
        return Err(PatchError::ManifestInvalid(format!(
            "{} has no dependency line to point at the probe",
            manifest.display()
        )));
    }
    let replacement = format!(
        "[dependencies.termwright-probe-ratatui]\npath = \"{}\"",
        probe_path.display()
    );
    fs::write(&manifest, text.replace(anchor, &replacement))?;
    Ok(())
}

/// Copy a crate out of the registry into a writable directory.
///
/// Cargo's registry sources keep the write bit — measured; unlike Go's module
/// cache, which strips it — so nothing has to be chmodded on the way out.
pub fn copy_out(source: &Path, destination: &Path) -> Result<PathBuf, PatchError> {
    if destination.exists() {
        fs::remove_dir_all(destination)?;
    }
    copy_tree(source, destination)?;
    Ok(destination.to_path_buf())
}

fn copy_tree(source: &Path, destination: &Path) -> io::Result<()> {
    fs::create_dir_all(destination)?;
    for entry in fs::read_dir(source)? {
        let entry = entry?;
        let target = destination.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_tree(&entry.path(), &target)?;
        } else {
            fs::copy(entry.path(), &target)?;
        }
    }
    Ok(())
}

// -- the two things this crate refuses to take a dependency for -------------

/// SHA-256, because the alternative is a dependency inside every instrumented
/// user's build of the framework.
fn sha256_hex(data: &[u8]) -> String {
    const K: [u32; 64] = [
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4,
        0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe,
        0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f,
        0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
        0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc,
        0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
        0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116,
        0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
        0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
        0xc67178f2,
    ];
    let mut state: [u32; 8] = [
        0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab,
        0x5be0cd19,
    ];

    let mut message = data.to_vec();
    let bit_length = (data.len() as u64) * 8;
    message.push(0x80);
    while message.len() % 64 != 56 {
        message.push(0);
    }
    message.extend_from_slice(&bit_length.to_be_bytes());

    for chunk in message.chunks(64) {
        let mut w = [0u32; 64];
        for (index, word) in chunk.chunks(4).enumerate() {
            w[index] = u32::from_be_bytes([word[0], word[1], word[2], word[3]]);
        }
        for index in 16..64 {
            let s0 = w[index - 15].rotate_right(7)
                ^ w[index - 15].rotate_right(18)
                ^ (w[index - 15] >> 3);
            let s1 = w[index - 2].rotate_right(17)
                ^ w[index - 2].rotate_right(19)
                ^ (w[index - 2] >> 10);
            w[index] = w[index - 16]
                .wrapping_add(s0)
                .wrapping_add(w[index - 7])
                .wrapping_add(s1);
        }

        let [mut a, mut b, mut c, mut d, mut e, mut f, mut g, mut h] = state;
        for index in 0..64 {
            let s1 = e.rotate_right(6) ^ e.rotate_right(11) ^ e.rotate_right(25);
            let ch = (e & f) ^ ((!e) & g);
            let temp1 = h
                .wrapping_add(s1)
                .wrapping_add(ch)
                .wrapping_add(K[index])
                .wrapping_add(w[index]);
            let s0 = a.rotate_right(2) ^ a.rotate_right(13) ^ a.rotate_right(22);
            let maj = (a & b) ^ (a & c) ^ (b & c);
            let temp2 = s0.wrapping_add(maj);

            h = g;
            g = f;
            f = e;
            e = d.wrapping_add(temp1);
            d = c;
            c = b;
            b = a;
            a = temp1.wrapping_add(temp2);
        }
        for (slot, value) in state.iter_mut().zip([a, b, c, d, e, f, g, h]) {
            *slot = slot.wrapping_add(value);
        }
    }

    state.iter().map(|word| format!("{word:08x}")).collect()
}

/// The smallest JSON reader that can read our own manifest.
mod json {
    use super::PatchError;

    #[derive(Debug, Clone, PartialEq)]
    pub enum Value {
        Object(Vec<(String, Value)>),
        Array(Vec<Value>),
        Str(String),
        Number(f64),
        Bool(bool),
        Null,
    }

    impl Value {
        fn get(&self, key: &str) -> Option<&Value> {
            match self {
                Value::Object(entries) => entries
                    .iter()
                    .find(|(name, _)| name == key)
                    .map(|(_, value)| value),
                _ => None,
            }
        }

        pub fn string(&self, key: &str) -> Result<String, PatchError> {
            match self.get(key) {
                Some(Value::Str(text)) => Ok(text.clone()),
                _ => Err(PatchError::ManifestInvalid(format!(
                    "{key} is not a string"
                ))),
            }
        }

        pub fn number(&self, key: &str) -> Result<f64, PatchError> {
            match self.get(key) {
                Some(Value::Number(value)) => Ok(*value),
                _ => Err(PatchError::ManifestInvalid(format!(
                    "{key} is not a number"
                ))),
            }
        }

        pub fn array(&self, key: &str) -> Result<Vec<Value>, PatchError> {
            match self.get(key) {
                Some(Value::Array(items)) => Ok(items.clone()),
                _ => Err(PatchError::ManifestInvalid(format!(
                    "{key} is not an array"
                ))),
            }
        }
    }

    pub fn parse(text: &str) -> Result<Value, String> {
        let bytes: Vec<char> = text.chars().collect();
        let mut cursor = 0usize;
        let value = parse_value(&bytes, &mut cursor)?;
        Ok(value)
    }

    fn skip_space(text: &[char], cursor: &mut usize) {
        while *cursor < text.len() && text[*cursor].is_whitespace() {
            *cursor += 1;
        }
    }

    fn parse_value(text: &[char], cursor: &mut usize) -> Result<Value, String> {
        skip_space(text, cursor);
        match text.get(*cursor) {
            Some('{') => parse_object(text, cursor),
            Some('[') => parse_array(text, cursor),
            Some('"') => Ok(Value::Str(parse_string(text, cursor)?)),
            Some('t') => take_literal(text, cursor, "true", Value::Bool(true)),
            Some('f') => take_literal(text, cursor, "false", Value::Bool(false)),
            Some('n') => take_literal(text, cursor, "null", Value::Null),
            Some(_) => parse_number(text, cursor),
            None => Err("unexpected end of manifest".to_owned()),
        }
    }

    fn take_literal(
        text: &[char],
        cursor: &mut usize,
        literal: &str,
        value: Value,
    ) -> Result<Value, String> {
        for expected in literal.chars() {
            if text.get(*cursor) != Some(&expected) {
                return Err(format!("expected {literal}"));
            }
            *cursor += 1;
        }
        Ok(value)
    }

    fn parse_object(text: &[char], cursor: &mut usize) -> Result<Value, String> {
        *cursor += 1; // '{'
        let mut entries = Vec::new();
        loop {
            skip_space(text, cursor);
            match text.get(*cursor) {
                Some('}') => {
                    *cursor += 1;
                    return Ok(Value::Object(entries));
                }
                Some(',') => {
                    *cursor += 1;
                }
                Some('"') => {
                    let key = parse_string(text, cursor)?;
                    skip_space(text, cursor);
                    if text.get(*cursor) != Some(&':') {
                        return Err(format!("expected ':' after {key}"));
                    }
                    *cursor += 1;
                    entries.push((key, parse_value(text, cursor)?));
                }
                other => return Err(format!("unexpected {other:?} in object")),
            }
        }
    }

    fn parse_array(text: &[char], cursor: &mut usize) -> Result<Value, String> {
        *cursor += 1; // '['
        let mut items = Vec::new();
        loop {
            skip_space(text, cursor);
            match text.get(*cursor) {
                Some(']') => {
                    *cursor += 1;
                    return Ok(Value::Array(items));
                }
                Some(',') => {
                    *cursor += 1;
                }
                Some(_) => items.push(parse_value(text, cursor)?),
                None => return Err("unterminated array".to_owned()),
            }
        }
    }

    fn parse_string(text: &[char], cursor: &mut usize) -> Result<String, String> {
        *cursor += 1; // opening quote
        let mut out = String::new();
        while let Some(&character) = text.get(*cursor) {
            *cursor += 1;
            match character {
                '"' => return Ok(out),
                '\\' => {
                    let escape = text.get(*cursor).copied().ok_or("dangling escape")?;
                    *cursor += 1;
                    out.push(match escape {
                        'n' => '\n',
                        't' => '\t',
                        'r' => '\r',
                        'b' => '\u{8}',
                        'f' => '\u{c}',
                        'u' => {
                            let hex: String = text
                                .get(*cursor..*cursor + 4)
                                .ok_or("truncated \\u escape")?
                                .iter()
                                .collect();
                            *cursor += 4;
                            let code =
                                u32::from_str_radix(&hex, 16).map_err(|_| "bad \\u escape")?;
                            char::from_u32(code).ok_or("bad code point")?
                        }
                        other => other,
                    });
                }
                other => out.push(other),
            }
        }
        Err("unterminated string".to_owned())
    }

    fn parse_number(text: &[char], cursor: &mut usize) -> Result<Value, String> {
        let start = *cursor;
        while let Some(&character) = text.get(*cursor) {
            if character.is_ascii_digit() || "+-.eE".contains(character) {
                *cursor += 1;
            } else {
                break;
            }
        }
        let literal: String = text[start..*cursor].iter().collect();
        literal
            .parse::<f64>()
            .map(Value::Number)
            .map_err(|_| format!("{literal} is not a number"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Checked against a known vector rather than against itself.
    #[test]
    fn sha256_matches_the_published_vectors() {
        assert_eq!(
            sha256_hex(b""),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
        assert_eq!(
            sha256_hex(b"abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
        assert_eq!(
            sha256_hex(&b"a".repeat(1_000_000))[..16],
            "cdc76e5c9914fb92"[..16]
        );
    }

    #[test]
    fn the_manifest_reader_reads_our_manifest() {
        let directory = Path::new("upstream-patches/ratatui-core/0.1.2");
        let manifest =
            read_manifest(&directory.join("manifest.json")).expect("the shipped manifest parses");
        assert_eq!(manifest.framework, "ratatui-core");
        assert_eq!(manifest.framework_version, "0.1.2");
        assert!(manifest.patch_set_version >= 1);

        // Not the version number and not the file list: pinning either turns
        // every legitimate change to the patch set into a test to update. What
        // is worth asserting is that the manifest describes something real.
        assert!(!manifest.patched.is_empty());
        for file in &manifest.patched {
            assert!(
                directory.join(&file.patch).is_file(),
                "{} names a patch that is not there",
                file.path
            );
            assert!(file.sha256_before.starts_with("sha256:"), "{file:?}");
            assert_ne!(
                file.sha256_before, file.sha256_after,
                "{} is pinned to the same state before and after, so the patch \
                 either does nothing or the manifest was not regenerated",
                file.path
            );
        }
    }
}
