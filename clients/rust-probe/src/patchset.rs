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

use std::collections::{HashMap, HashSet};
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

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
    /// Whether this patched crate declares a direct dependency on the probe.
    pub requires_probe: bool,
    pub patched: Vec<PatchedFile>,
}

/// The fields the launcher needs from one `cargo metadata` package entry.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct MetadataPackage {
    pub id: String,
    pub name: String,
    pub version: String,
    pub source: Option<String>,
    pub manifest_path: PathBuf,
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
    /// The pinned unified diff did not match the pinned source bytes.
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

/// Stable digest of a complete patch set, including the manifest and every
/// patch it names.
///
/// The manifest's before/after hashes catch a bad application, but they do not
/// invalidate an already materialised cache entry when somebody edits a patch
/// without regenerating the manifest. Hashing the actual patch bytes closes
/// that gap.
pub fn digest_patch_set(patch_set_dir: &Path) -> Result<String, PatchError> {
    let manifest_path = patch_set_dir.join("manifest.json");
    let manifest_bytes = fs::read(&manifest_path)?;
    let manifest = read_manifest(&manifest_path)?;
    let mut input = Vec::new();
    append_digest_part(&mut input, &manifest_bytes);
    for file in &manifest.patched {
        append_digest_part(&mut input, file.patch.as_bytes());
        append_digest_part(&mut input, &fs::read(patch_set_dir.join(&file.patch))?);
    }
    Ok(format!("sha256:{}", sha256_hex(&input)))
}

fn append_digest_part(output: &mut Vec<u8>, part: &[u8]) {
    output.extend_from_slice(&(part.len() as u64).to_be_bytes());
    output.extend_from_slice(part);
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
    let requires_probe = !value.array("requires")?.is_empty();
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
        requires_probe,
        patched,
    })
}

/// Parse only the top-level `packages` array from `cargo metadata`.
///
/// Searching the JSON text is incorrect because dependency summaries nested
/// inside an earlier package can contain the same crate name before the real
/// package entry. Keeping this beside the existing tiny JSON reader avoids a
/// runtime serde dependency while still respecting the document structure.
#[cfg(test)]
pub(crate) fn read_metadata_packages(text: &str) -> Result<Vec<MetadataPackage>, PatchError> {
    let value = json::parse(text).map_err(PatchError::ManifestInvalid)?;
    read_packages(&value)
}

/// Restrict metadata to the dependency graph rooted at one package manifest.
/// Cargo reports every member of a workspace even when invoked from one
/// member, so filtering only by package name would let an unrelated sibling's
/// Ratatui dependency select the patch set.
pub(crate) fn read_reachable_metadata_packages(
    text: &str,
    root_manifest: &Path,
    use_workspace_default_members: bool,
) -> Result<Vec<MetadataPackage>, PatchError> {
    let value = json::parse(text).map_err(PatchError::ManifestInvalid)?;
    let packages = read_packages(&value)?;
    // At a workspace root Cargo builds `workspace.default-members`, including
    // when that root also has a `[package]`. From a member directory it builds
    // only that package. The caller knows which of those two commands it is
    // preparing; the metadata document by itself does not encode the cwd.
    let roots = if use_workspace_default_members {
        value
            .array("workspace_default_members")?
            .into_iter()
            .map(|member| member.into_string("workspace default member id"))
            .collect::<Result<Vec<_>, _>>()?
    } else {
        vec![packages
            .iter()
            .find(|package| same_path(&package.manifest_path, root_manifest))
            .map(|package| package.id.clone())
            .ok_or_else(|| {
                PatchError::ManifestInvalid(format!(
                    "cargo metadata did not contain the selected package manifest {}",
                    root_manifest.display()
                ))
            })?]
    };
    if roots.is_empty() {
        return Err(PatchError::ManifestInvalid(format!(
            "cargo metadata has no package or default workspace member for {}",
            root_manifest.display()
        )));
    }

    let resolve = value.object("resolve")?;
    let mut edges = HashMap::<String, Vec<String>>::new();
    for node in resolve.array("nodes")? {
        let dependencies = node
            .array("dependencies")?
            .into_iter()
            .map(|dependency| dependency.into_string("dependency package id"))
            .collect::<Result<Vec<_>, _>>()?;
        edges.insert(node.string("id")?, dependencies);
    }

    let mut reachable = HashSet::new();
    let mut pending = roots;
    while let Some(id) = pending.pop() {
        if !reachable.insert(id.clone()) {
            continue;
        }
        if let Some(dependencies) = edges.get(&id) {
            pending.extend(dependencies.iter().cloned());
        }
    }
    Ok(packages
        .into_iter()
        .filter(|package| reachable.contains(&package.id))
        .collect())
}

fn read_packages(value: &json::Value) -> Result<Vec<MetadataPackage>, PatchError> {
    value
        .array("packages")?
        .into_iter()
        .map(|package| {
            Ok(MetadataPackage {
                id: package.string("id")?,
                name: package.string("name")?,
                version: package.string("version")?,
                source: package.optional_string("source")?,
                manifest_path: PathBuf::from(package.string("manifest_path")?),
            })
        })
        .collect()
}

fn same_path(left: &Path, right: &Path) -> bool {
    match (fs::canonicalize(left), fs::canonicalize(right)) {
        (Ok(left), Ok(right)) => left == right,
        _ => left == right,
    }
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
        let target = copy.join(&file.path);
        let source = fs::read_to_string(&target)?;
        let patch = fs::read_to_string(patch_set_dir.join(&file.patch))?;
        let patched =
            apply_unified_diff(&source, &patch).map_err(|detail| PatchError::ApplyFailed {
                path: file.path.clone(),
                detail,
            })?;
        fs::write(target, patched)?;
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

    if manifest.requires_probe {
        supply_probe_path(copy, probe_path)?;
    }
    Ok(())
}

/// Apply the deliberately small subset of unified diff emitted by the patch
/// generator: text hunks with exact context, additions and removals.
///
/// Patch preparation must not assume Unix developer tools: neither `patch` nor
/// `git.exe` is guaranteed by a Rust installation. Paths, renames, binary
/// patches and fuzzy matching are intentionally not implemented: the manifest
/// already selects the target file and pins its complete before/after digest.
fn apply_unified_diff(source: &str, patch: &str) -> Result<String, String> {
    let source_lines: Vec<&str> = source.split_inclusive('\n').collect();
    let patch_lines: Vec<&str> = patch.split_inclusive('\n').collect();
    let mut output = String::with_capacity(source.len() + patch.len() / 2);
    let mut source_cursor = 0usize;
    let mut patch_cursor = 0usize;
    let mut saw_hunk = false;

    while patch_cursor < patch_lines.len() {
        let header = patch_lines[patch_cursor].trim_end_matches(['\r', '\n']);
        if !header.starts_with("@@ ") {
            patch_cursor += 1;
            continue;
        }
        saw_hunk = true;
        let (old_start, old_count, new_count) = parse_hunk_header(header)?;
        let hunk_start = old_start.saturating_sub(1);
        if hunk_start < source_cursor || hunk_start > source_lines.len() {
            return Err(format!(
                "hunk starts at source line {old_start}, after line {} was already consumed",
                source_cursor + 1
            ));
        }
        for line in &source_lines[source_cursor..hunk_start] {
            output.push_str(line);
        }
        source_cursor = hunk_start;
        patch_cursor += 1;
        let mut old_seen = 0usize;
        let mut new_seen = 0usize;

        while patch_cursor < patch_lines.len() {
            let line = patch_lines[patch_cursor];
            if line.starts_with("@@ ") {
                break;
            }
            let Some(marker) = line.as_bytes().first().copied() else {
                return Err("an empty line in a hunk has no unified-diff marker".to_owned());
            };
            let body = &line[1..];
            match marker {
                b' ' => {
                    match_source_line(&source_lines, source_cursor, body, old_start)?;
                    output.push_str(body);
                    source_cursor += 1;
                    old_seen += 1;
                    new_seen += 1;
                }
                b'-' => {
                    match_source_line(&source_lines, source_cursor, body, old_start)?;
                    source_cursor += 1;
                    old_seen += 1;
                }
                b'+' => {
                    output.push_str(body);
                    new_seen += 1;
                }
                b'\\' => {
                    return Err(
                        "patches for files without a trailing newline are unsupported".to_owned(),
                    );
                }
                _ => break,
            }
            patch_cursor += 1;
        }
        if old_seen != old_count || new_seen != new_count {
            return Err(format!(
                "hunk count mismatch: header says -{old_count}/+{new_count}, body has -{old_seen}/+{new_seen}"
            ));
        }
    }

    if !saw_hunk {
        return Err("patch contains no unified-diff hunks".to_owned());
    }
    for line in &source_lines[source_cursor..] {
        output.push_str(line);
    }
    Ok(output)
}

fn parse_hunk_header(header: &str) -> Result<(usize, usize, usize), String> {
    let end = header[3..]
        .find(" @@")
        .map(|offset| offset + 3)
        .ok_or_else(|| format!("invalid hunk header: {header}"))?;
    let mut ranges = header[3..end].split_whitespace();
    let old = ranges
        .next()
        .and_then(|range| range.strip_prefix('-'))
        .ok_or_else(|| format!("invalid old range in hunk header: {header}"))?;
    let new = ranges
        .next()
        .and_then(|range| range.strip_prefix('+'))
        .ok_or_else(|| format!("invalid new range in hunk header: {header}"))?;
    let (old_start, old_count) = parse_range(old)?;
    let (_, new_count) = parse_range(new)?;
    Ok((old_start, old_count, new_count))
}

fn parse_range(range: &str) -> Result<(usize, usize), String> {
    let mut parts = range.split(',');
    let start = parts
        .next()
        .ok_or_else(|| format!("missing hunk range: {range}"))?
        .parse::<usize>()
        .map_err(|_| format!("invalid hunk range: {range}"))?;
    let count = parts
        .next()
        .map(str::parse::<usize>)
        .transpose()
        .map_err(|_| format!("invalid hunk range: {range}"))?
        .unwrap_or(1);
    if parts.next().is_some() {
        return Err(format!("invalid hunk range: {range}"));
    }
    Ok((start, count))
}

fn match_source_line(
    source: &[&str],
    index: usize,
    expected: &str,
    hunk_start: usize,
) -> Result<(), String> {
    match source.get(index) {
        Some(actual) if *actual == expected => Ok(()),
        Some(actual) => Err(format!(
            "hunk at line {hunk_start} expected {:?} at source line {}, found {:?}",
            expected.trim_end(),
            index + 1,
            actual.trim_end()
        )),
        None => Err(format!(
            "hunk at line {hunk_start} reads past the end of the source"
        )),
    }
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
        "[dependencies.termwright-probe-ratatui]\npath = {}",
        toml_string(&probe_path.to_string_lossy())
    );
    fs::write(&manifest, text.replace(anchor, &replacement))?;
    Ok(())
}

/// A TOML basic string suitable for paths in generated Cargo configuration.
///
/// Windows separators and quotes in legal Unix paths both need escaping. A
/// single-quoted TOML literal handles the former but cannot represent an
/// apostrophe, so the launcher consistently emits basic strings instead.
pub(crate) fn toml_string(value: &str) -> String {
    let mut output = String::with_capacity(value.len() + 2);
    output.push('"');
    for character in value.chars() {
        match character {
            '"' => output.push_str("\\\""),
            '\\' => output.push_str("\\\\"),
            '\n' => output.push_str("\\n"),
            '\r' => output.push_str("\\r"),
            '\t' => output.push_str("\\t"),
            character if character <= '\u{001f}' || character == '\u{007f}' => {
                output.push_str(&format!("\\u{:04X}", character as u32));
            }
            character => output.push(character),
        }
    }
    output.push('"');
    output
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
pub(crate) fn sha256_hex(data: &[u8]) -> String {
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

        pub fn optional_string(&self, key: &str) -> Result<Option<String>, PatchError> {
            match self.get(key) {
                Some(Value::Str(text)) => Ok(Some(text.clone())),
                Some(Value::Null) | None => Ok(None),
                _ => Err(PatchError::ManifestInvalid(format!(
                    "{key} is neither a string nor null"
                ))),
            }
        }

        pub fn object(&self, key: &str) -> Result<Value, PatchError> {
            match self.get(key) {
                Some(value @ Value::Object(_)) => Ok(value.clone()),
                _ => Err(PatchError::ManifestInvalid(format!(
                    "{key} is not an object"
                ))),
            }
        }

        pub fn into_string(self, label: &str) -> Result<String, PatchError> {
            match self {
                Value::Str(text) => Ok(text),
                _ => Err(PatchError::ManifestInvalid(format!(
                    "{label} is not a string"
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

    #[test]
    fn the_patch_set_digest_includes_patch_bytes() {
        let source = Path::new("upstream-patches/ratatui-core/0.1.2");
        let copy = std::env::temp_dir().join(format!("tw-patch-digest-{}", std::process::id()));
        let _ = fs::remove_dir_all(&copy);
        copy_tree(source, &copy).expect("copy patch set");

        let before = digest_patch_set(&copy).expect("digest");
        let patch = copy.join("patches/Cargo.toml.patch");
        let mut bytes = fs::read(&patch).expect("patch");
        bytes.extend_from_slice(b"\n# cache-buster\n");
        fs::write(&patch, bytes).expect("mutate patch");
        let after = digest_patch_set(&copy).expect("digest after mutation");

        assert_ne!(before, after);
        let _ = fs::remove_dir_all(copy);
    }

    #[test]
    fn generated_toml_paths_escape_windows_and_unix_edge_cases() {
        assert_eq!(
            toml_string("C:\\Users\\O'Brien\\probe\"copy"),
            "\"C:\\\\Users\\\\O'Brien\\\\probe\\\"copy\""
        );
    }

    #[test]
    fn metadata_reader_ignores_nested_dependency_summaries() {
        let metadata = r#"{
          "packages": [
            {
              "id": "registry+ratatui@0.30.0",
              "name": "ratatui",
              "version": "0.30.0",
              "source": "registry+https://github.com/rust-lang/crates.io-index",
              "manifest_path": "/registry/ratatui-0.30.0/Cargo.toml",
              "dependencies": [
                {"name": "ratatui-widgets", "version": "0.1.2"}
              ]
            },
            {
              "id": "registry+ratatui-widgets@0.3.2",
              "name": "ratatui-widgets",
              "version": "0.3.2",
              "source": "registry+https://github.com/rust-lang/crates.io-index",
              "manifest_path": "/registry/ratatui-widgets-0.3.2/Cargo.toml"
            }
          ]
        }"#;
        let packages = read_metadata_packages(metadata).expect("metadata parses");
        let widgets = packages
            .iter()
            .find(|package| package.name == "ratatui-widgets")
            .expect("widgets package");
        assert_eq!(widgets.version, "0.3.2");
    }

    #[test]
    fn metadata_graph_excludes_unrelated_workspace_siblings() {
        let root = std::env::temp_dir().join(format!("tw-metadata-root-{}", std::process::id()));
        let sibling = root.with_file_name(format!("tw-metadata-sibling-{}", std::process::id()));
        fs::write(&root, "").expect("root manifest placeholder");
        fs::write(&sibling, "").expect("sibling manifest placeholder");
        let metadata = format!(
            r#"{{"packages":[
              {{"id":"app 0.1.0","name":"app","version":"0.1.0","source":null,
                "manifest_path":{:?}}},
              {{"id":"sibling 0.1.0","name":"sibling","version":"0.1.0","source":null,
                "manifest_path":{:?}}},
              {{"id":"ratatui-core 0.1.2","name":"ratatui-core","version":"0.1.2",
                "source":"registry+https://github.com/rust-lang/crates.io-index",
                "manifest_path":"/registry/core/Cargo.toml"}}
            ],"resolve":{{"nodes":[
              {{"id":"app 0.1.0","dependencies":[]}},
              {{"id":"sibling 0.1.0","dependencies":["ratatui-core 0.1.2"]}},
              {{"id":"ratatui-core 0.1.2","dependencies":[]}}
            ]}}}}"#,
            root.to_string_lossy(),
            sibling.to_string_lossy()
        );
        let packages = read_reachable_metadata_packages(&metadata, &root, false).expect("graph");
        assert_eq!(packages.len(), 1);
        assert_eq!(packages[0].name, "app");
        let _ = fs::remove_file(root);
        let _ = fs::remove_file(sibling);
    }

    #[test]
    fn metadata_graph_uses_virtual_workspace_default_members() {
        let workspace =
            std::env::temp_dir().join(format!("tw-virtual-workspace-{}", std::process::id()));
        fs::write(&workspace, "[workspace]\n").expect("workspace manifest placeholder");
        let metadata = r#"{"packages":[
          {"id":"default","name":"default-app","version":"0.1.0","source":null,
           "manifest_path":"/workspace/default/Cargo.toml"},
          {"id":"other","name":"other-app","version":"0.1.0","source":null,
           "manifest_path":"/workspace/other/Cargo.toml"},
          {"id":"core","name":"ratatui-core","version":"0.1.2",
           "source":"registry+https://github.com/rust-lang/crates.io-index",
           "manifest_path":"/registry/core/Cargo.toml"}],
          "workspace_default_members":["default"],
          "resolve":{"nodes":[
            {"id":"default","dependencies":["core"]},
            {"id":"other","dependencies":[]},
            {"id":"core","dependencies":[]}
          ]}}"#;
        let packages =
            read_reachable_metadata_packages(metadata, &workspace, true).expect("virtual graph");
        assert_eq!(
            packages
                .iter()
                .map(|package| package.id.as_str())
                .collect::<Vec<_>>(),
            vec!["default", "core"]
        );
        let _ = fs::remove_file(workspace);
    }

    #[test]
    fn metadata_graph_uses_defaults_at_a_non_virtual_workspace_root() {
        let root =
            std::env::temp_dir().join(format!("tw-package-workspace-root-{}", std::process::id()));
        fs::write(
            &root,
            "[package]\nname='root'\nversion='0.1.0'\n[workspace]\n",
        )
        .expect("root manifest placeholder");
        let metadata = format!(
            r#"{{"packages":[
              {{"id":"root","name":"root","version":"0.1.0","source":null,
                "manifest_path":{:?}}},
              {{"id":"default","name":"default-app","version":"0.1.0","source":null,
                "manifest_path":"/workspace/default/Cargo.toml"}},
              {{"id":"core","name":"ratatui-core","version":"0.1.2",
                "source":"registry+https://github.com/rust-lang/crates.io-index",
                "manifest_path":"/registry/core/Cargo.toml"}}
            ],"workspace_default_members":["default"],"resolve":{{"nodes":[
              {{"id":"root","dependencies":[]}},
              {{"id":"default","dependencies":["core"]}},
              {{"id":"core","dependencies":[]}}
            ]}}}}"#,
            root.to_string_lossy()
        );
        let packages =
            read_reachable_metadata_packages(&metadata, &root, true).expect("default graph");
        assert_eq!(
            packages
                .iter()
                .map(|package| package.id.as_str())
                .collect::<Vec<_>>(),
            vec!["default", "core"]
        );
        let _ = fs::remove_file(root);
    }

    #[test]
    fn built_in_diff_applier_handles_multiple_hunks() {
        let source = "one\ntwo\nthree\nfour\nfive\n";
        let patch = "--- a/example\n+++ b/example\n@@ -1,2 +1,3 @@\n one\n+inserted\n two\n@@ -4,2 +5,1 @@\n four\n-five\n";
        assert_eq!(
            apply_unified_diff(source, patch).expect("apply"),
            "one\ninserted\ntwo\nthree\nfour\n"
        );
    }

    #[test]
    fn built_in_diff_applier_rejects_fuzzy_context() {
        let patch = "--- a/example\n+++ b/example\n@@ -1 +1 @@\n-not this\n+replacement\n";
        let error = apply_unified_diff("actual\n", patch).expect_err("context must be exact");
        assert!(error.contains("expected"), "{error}");
    }
}
