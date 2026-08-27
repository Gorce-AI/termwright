//! Everything a build needs to compile against the instrumented framework.
//!
//! This prepares and returns; it does not build and does not spawn the
//! application. A launcher owns that decision, and keeping it out of here is
//! what makes the whole thing testable without running somebody's TUI.
//!
//! Two things make the Rust version different from the Go one it mirrors.
//!
//! **Three crates, not one.** `ratatui-core` sees every render call but cannot
//! read a widget's state — `StatefulWidget::State` is `?Sized`, so it cannot
//! even be downcast — while `ratatui-widgets` knows the concrete `ListState`
//! and can reach `List::items`, which is `pub(crate)`. `ratatui-crossterm`
//! owns the exact writer that carries a normal terminal frame and is the only
//! backend certified to append its commit marker. The backend crate is
//! optional in the graph; without it semantic publication fails closed.
//!
//! **`Cargo.lock` has to be put back.** A patched build rewrites it: the
//! `ratatui-core` entry loses its `source` and `checksum` and becomes a path
//! dependency. Measured, and measured again in reverse — any ordinary build
//! restores the file byte for byte, `--offline` included. So the damage is
//! exactly reversible, and [`LockGuard`] reverses it rather than hoping the
//! user's next build does. The one case it cannot cover is another build
//! racing the restore, which the README says out loud.

use std::fs;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::thread::JoinHandle;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use crate::patchset::{
    apply, copy_out, digest_patch_set, read_manifest, read_reachable_metadata_packages, sha256_hex,
    toml_string, MetadataPackage, PatchError,
};

/// Crates this probe knows how to patch, and where their patch sets live.
const PATCHED_CRATES: [&str; 3] = ["ratatui-core", "ratatui-widgets", "ratatui-crossterm"];

/// These provide the tree. A project may deliberately omit Crossterm and use
/// a custom backend; that build remains valid but its semantic session is
/// refused at runtime because no marker sink is certified.
const REQUIRED_PATCHED_CRATES: [&str; 2] = ["ratatui-core", "ratatui-widgets"];

/// The public framework package whose version belongs in the probe handshake.
const FRAMEWORK_CRATE: &str = "ratatui";

/// Version of the probe, and therefore of the code a patched crate calls.
const PROBE_VERSION: &str = env!("CARGO_PKG_VERSION");

/// Separates concurrent staging directories in one process.
static CACHE_NONCE: AtomicU64 = AtomicU64::new(0);

/// What a caller has to decide before a build can be prepared.
#[derive(Debug, Clone)]
pub struct PrepareOptions {
    /// The user's project. Its workspace `Cargo.lock` is saved and restored.
    pub project: PathBuf,
    /// Cache root for instrumented copies. Defaults to Termwright's user cache.
    pub workspace: Option<PathBuf>,
    /// Where this crate lives, for the patched manifests to point at. The
    /// default is the source directory Cargo compiled this crate from.
    pub probe: Option<PathBuf>,
}

impl PrepareOptions {
    /// The zero-config path: a caller only names the project it wants to build.
    pub fn new(project: impl Into<PathBuf>) -> Self {
        Self {
            project: project.into(),
            workspace: None,
            probe: None,
        }
    }
}

/// What the build needs, and nothing else.
#[derive(Debug)]
pub struct PreparedBuild {
    /// Pass each of these to cargo as `--config <arg>`.
    pub config_args: Vec<String>,
    /// Environment the build should carry, on top of the caller's.
    pub env: Vec<(String, String)>,
    /// The instrumented copies, for a canary check or for diagnosis.
    pub copies: Vec<PathBuf>,
    /// True when at least one copy was materialised instead of reused.
    pub built: bool,
    /// Restores the workspace's `Cargo.lock` when this value is dropped.
    lock: LockGuard,
}

impl PreparedBuild {
    /// Restore `Cargo.lock` now and report any failure.
    pub fn finish(self) -> Result<(), PatchError> {
        self.lock.finish()
    }
}

/// Holds the bytes of a `Cargo.lock` so a patched build can be undone.
#[derive(Debug)]
pub struct LockGuard {
    path: PathBuf,
    original: Option<Vec<u8>>,
    permissions: Option<fs::Permissions>,
    restored: bool,
}

impl LockGuard {
    /// Remember the lockfile as it is now, if there is one.
    ///
    /// A project without a committed lock has nothing to protect, and creating
    /// one would be the very modification this exists to prevent.
    pub fn save(project: &Path) -> Result<Self, PatchError> {
        let path = project.join("Cargo.lock");
        let original = if path.is_file() {
            Some(fs::read(&path)?)
        } else {
            None
        };
        let permissions = if path.is_file() {
            Some(fs::metadata(&path)?.permissions())
        } else {
            None
        };
        Ok(Self {
            original,
            permissions,
            path,
            restored: false,
        })
    }

    /// Put the original bytes back. Idempotent.
    pub fn restore(&mut self) -> Result<(), PatchError> {
        if self.restored {
            return Ok(());
        }
        match &self.original {
            Some(original) => {
                // A prepare that only reads metadata must not perturb mtime.
                // Write only after Cargo actually changed the bytes.
                if fs::read(&self.path).map_or(true, |current| current != *original) {
                    fs::write(&self.path, original)?;
                }
                if let Some(permissions) = &self.permissions {
                    if permissions_differ(&fs::metadata(&self.path)?.permissions(), permissions) {
                        fs::set_permissions(&self.path, permissions.clone())?;
                    }
                }
            }
            None => match fs::remove_file(&self.path) {
                Ok(()) => {}
                Err(error) if error.kind() == ErrorKind::NotFound => {}
                Err(error) => return Err(error.into()),
            },
        }
        self.restored = true;
        Ok(())
    }

    /// Restore, and say whether it worked.
    ///
    /// The `Drop` path cannot report a failure, so a caller that wants to know
    /// calls this instead.
    pub fn finish(mut self) -> Result<(), PatchError> {
        self.restore()
    }
}

impl Drop for LockGuard {
    fn drop(&mut self) {
        // Best effort. A caller that needs to know uses `finish`.
        let _ = self.restore();
    }
}

#[cfg(unix)]
fn permissions_differ(left: &fs::Permissions, right: &fs::Permissions) -> bool {
    use std::os::unix::fs::PermissionsExt;
    left.mode() != right.mode()
}

#[cfg(not(unix))]
fn permissions_differ(left: &fs::Permissions, right: &fs::Permissions) -> bool {
    left.readonly() != right.readonly()
}

/// Prepare an instrumented build of `options.project`.
pub fn prepare_instrumented_build(options: &PrepareOptions) -> Result<PreparedBuild, PatchError> {
    // `cargo locate-project` does not resolve dependencies or touch a lockfile.
    // Locate the workspace before metadata, then save the lock Cargo will
    // actually modify when `project` is a member rather than the root.
    let project_manifest = cargo_project_manifest(&options.project)?;
    let workspace_root = cargo_workspace_root(&options.project)?;
    let at_workspace_root = same_filesystem_path(&options.project, &workspace_root);
    let lock = LockGuard::save(&workspace_root)?;
    let resolved = resolve_versions(&options.project, &project_manifest, at_workspace_root)?;
    let toolchain = rust_toolchain(&options.project)?;
    let target = std::env::var("CARGO_BUILD_TARGET").unwrap_or_else(|_| host_from(&toolchain));
    let features = feature_fingerprint(&options.project, &resolved)?;
    let cache_root = options.workspace.clone().unwrap_or_else(default_cache_root);
    let probe = fs::canonicalize(
        options
            .probe
            .as_deref()
            .unwrap_or_else(|| Path::new(env!("CARGO_MANIFEST_DIR"))),
    )?;
    let mut config_args = Vec::new();
    let mut copies = Vec::new();
    let mut env = Vec::new();
    let mut built = false;

    for name in REQUIRED_PATCHED_CRATES {
        if !resolved.iter().any(|package| package.name == name) {
            return Err(PatchError::ManifestInvalid(format!(
                "{} does not depend on {name}; is this a Ratatui project?",
                options.project.display()
            )));
        }
    }

    let framework_version = resolved
        .iter()
        .find(|package| package.name == FRAMEWORK_CRATE)
        .map(|package| package.version.clone())
        .ok_or_else(|| {
            PatchError::ManifestInvalid(format!(
                "{} reaches Ratatui internals but not the public {FRAMEWORK_CRATE} crate; the probe cannot report a truthful framework version",
                options.project.display()
            ))
        })?;
    env.push(("TERMWRIGHT_RATATUI_VERSION".to_owned(), framework_version));

    for name in PATCHED_CRATES {
        let Some(package) = resolved.iter().find(|package| package.name == name) else {
            continue;
        };
        let version = &package.version;
        require_crates_io_source(package)?;
        let patch_set = patch_set_dir(name, version);
        if !patch_set.is_dir() {
            return Err(PatchError::ManifestInvalid(format!(
                "no patch set for {name} {version}; this probe supports the versions under \
                 upstream-patches/{name}/"
            )));
        }
        let manifest = read_manifest(&patch_set.join("manifest.json"))?;
        if manifest.framework != name || manifest.framework_version != *version {
            return Err(PatchError::ManifestInvalid(format!(
                "{} declares {} {}, expected {name} {version}",
                patch_set.display(),
                manifest.framework,
                manifest.framework_version
            )));
        }
        let source = ensure_unpacked_source(package, &options.project)?;
        let source_digest = digest_cache_contents(&source)?;
        let key = copy_key(&CacheKeyInput {
            framework: name,
            framework_version: version,
            source_digest: &source_digest,
            probe_version: PROBE_VERSION,
            toolchain: &toolchain,
            target: &target,
            features: &features,
            patch_digest: &digest_patch_set(&patch_set)?,
            probe_path: &probe.to_string_lossy(),
        });
        let copy = cache_root
            .join("copies")
            .join(name)
            .join(format!("{version}-{key}"));
        if !cache_entry_complete(&copy, &key) {
            built |= materialize_cache_entry(&source, &copy, &patch_set, &manifest, &probe, &key)?;
        }

        config_args.push(format!(
            "patch.crates-io.{name}.path={}",
            toml_string(&copy.to_string_lossy())
        ));
        copies.push(copy);
    }

    Ok(PreparedBuild {
        config_args,
        env,
        copies,
        built,
        lock,
    })
}

/// Default cache location, shared with the TypeScript probe launchers.
pub fn default_cache_root() -> PathBuf {
    if let Some(path) = std::env::var_os("TERMWRIGHT_CACHE_DIR").filter(|value| !value.is_empty()) {
        return PathBuf::from(path);
    }
    if let Some(path) = std::env::var_os("XDG_CACHE_HOME").filter(|value| !value.is_empty()) {
        return PathBuf::from(path).join("termwright");
    }
    if let Some(home) = std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .filter(|value| !value.is_empty())
    {
        return PathBuf::from(home).join(".cache").join("termwright");
    }
    std::env::temp_dir().join("termwright-cache")
}

struct CacheKeyInput<'a> {
    framework: &'a str,
    framework_version: &'a str,
    source_digest: &'a str,
    probe_version: &'a str,
    toolchain: &'a str,
    target: &'a str,
    features: &'a str,
    patch_digest: &'a str,
    probe_path: &'a str,
}

fn copy_key(input: &CacheKeyInput<'_>) -> String {
    let mut bytes = Vec::new();
    for part in [
        input.framework,
        input.framework_version,
        input.source_digest,
        input.probe_version,
        input.toolchain,
        input.target,
        input.features,
        input.patch_digest,
        input.probe_path,
    ] {
        bytes.extend_from_slice(&(part.len() as u64).to_be_bytes());
        bytes.extend_from_slice(part.as_bytes());
    }
    sha256_hex(&bytes)[..32].to_owned()
}

fn cache_entry_complete(copy: &Path, key: &str) -> bool {
    let Ok(stamp) = fs::read_to_string(copy.join(".termwright-complete")) else {
        return false;
    };
    let mut lines = stamp.lines();
    if lines.next() != Some(key) {
        return false;
    }
    let Some(expected_digest) = lines.next() else {
        return false;
    };
    lines.next().is_none()
        && digest_cache_contents(copy)
            .map(|digest| digest == expected_digest)
            .unwrap_or(false)
}

fn digest_cache_contents(root: &Path) -> Result<String, PatchError> {
    fn walk(root: &Path, directory: &Path, input: &mut Vec<u8>) -> Result<(), PatchError> {
        let mut entries = fs::read_dir(directory)?.collect::<Result<Vec<_>, _>>()?;
        entries.sort_by_key(|entry| entry.file_name());
        for entry in entries {
            let path = entry.path();
            let relative = path.strip_prefix(root).map_err(|_| {
                PatchError::ManifestInvalid(format!(
                    "{} escaped cache root {}",
                    path.display(),
                    root.display()
                ))
            })?;
            if relative == Path::new(".termwright-complete") {
                continue;
            }
            append_cache_digest_part(input, relative.to_string_lossy().as_bytes());
            if entry.file_type()?.is_dir() {
                input.push(b'd');
                walk(root, &path, input)?;
            } else {
                input.push(b'f');
                append_cache_digest_part(input, &fs::read(path)?);
            }
        }
        Ok(())
    }

    let mut input = Vec::new();
    walk(root, root, &mut input)?;
    Ok(format!("sha256:{}", sha256_hex(&input)))
}

fn append_cache_digest_part(output: &mut Vec<u8>, part: &[u8]) {
    output.extend_from_slice(&(part.len() as u64).to_be_bytes());
    output.extend_from_slice(part);
}

fn materialize_cache_entry(
    source: &Path,
    copy: &Path,
    patch_set: &Path,
    manifest: &crate::patchset::PatchManifest,
    probe: &Path,
    key: &str,
) -> Result<bool, PatchError> {
    let parent = copy.parent().ok_or_else(|| {
        PatchError::ManifestInvalid(format!("{} has no cache parent", copy.display()))
    })?;
    fs::create_dir_all(parent)?;

    let Some(_lock) = CacheLock::acquire(copy, key)? else {
        return Ok(false);
    };
    // A waiter may have completed the entry before this process acquired the
    // lock. It is now a normal cache hit.
    if cache_entry_complete(copy, key) {
        return Ok(false);
    }

    // A complete entry only appears through the final rename. Interrupted
    // writers leave a uniquely named staging directory, never a cache hit.
    if copy.exists() {
        fs::remove_dir_all(copy)?;
    }
    let nonce = CACHE_NONCE.fetch_add(1, Ordering::Relaxed);
    let clock = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let name = copy
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("copy");
    let staging = parent.join(format!(
        ".{name}.{}.{}.{}.tmp",
        std::process::id(),
        clock,
        nonce
    ));

    let prepared = (|| -> Result<(), PatchError> {
        copy_out(source, &staging)?;
        apply(manifest, patch_set, &staging, probe)?;
        let content_digest = digest_cache_contents(&staging)?;
        fs::write(
            staging.join(".termwright-complete"),
            format!("{key}\n{content_digest}\n"),
        )?;
        Ok(())
    })();
    if let Err(error) = prepared {
        let _ = fs::remove_dir_all(&staging);
        return Err(error);
    }

    match fs::rename(&staging, copy) {
        Ok(()) => Ok(true),
        Err(error) => {
            let _ = fs::remove_dir_all(&staging);
            Err(error.into())
        }
    }
}

struct CacheLock {
    path: PathBuf,
    token: String,
    stop: Arc<AtomicBool>,
    heartbeat: Option<JoinHandle<()>>,
}

impl CacheLock {
    fn acquire(copy: &Path, key: &str) -> Result<Option<Self>, PatchError> {
        let parent = copy.parent().ok_or_else(|| {
            PatchError::ManifestInvalid(format!("{} has no cache parent", copy.display()))
        })?;
        let name = copy
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("copy");
        let path = parent.join(format!(".{name}.lock"));
        let started = Instant::now();
        let token = format!(
            "{}-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos(),
            CACHE_NONCE.fetch_add(1, Ordering::Relaxed)
        );
        loop {
            match fs::create_dir(&path) {
                Ok(()) => {
                    let owner = path.join("owner");
                    if let Err(error) = fs::write(&owner, &token) {
                        let _ = fs::remove_dir_all(&path);
                        return Err(error.into());
                    }
                    let stop = Arc::new(AtomicBool::new(false));
                    let heartbeat_stop = Arc::clone(&stop);
                    let heartbeat_token = token.clone();
                    let heartbeat = std::thread::Builder::new()
                        .name("termwright-cache-heartbeat".to_owned())
                        .spawn(move || {
                            while !heartbeat_stop.load(Ordering::Acquire) {
                                std::thread::park_timeout(Duration::from_secs(5));
                                if heartbeat_stop.load(Ordering::Acquire) {
                                    break;
                                }
                                let still_owned = fs::read_to_string(&owner)
                                    .map(|current| current == heartbeat_token)
                                    .unwrap_or(false);
                                if !still_owned {
                                    break;
                                }
                                // Rewriting the same token renews the lease by
                                // updating the owner file's modification time.
                                let _ = fs::write(&owner, &heartbeat_token);
                            }
                        })?;
                    return Ok(Some(Self {
                        path,
                        token,
                        stop,
                        heartbeat: Some(heartbeat),
                    }));
                }
                Err(error) if error.kind() == ErrorKind::AlreadyExists => {
                    if cache_entry_complete(copy, key) {
                        return Ok(None);
                    }
                    let stale = fs::metadata(path.join("owner"))
                        .or_else(|_| fs::metadata(&path))
                        .and_then(|metadata| metadata.modified())
                        .ok()
                        .and_then(|modified| SystemTime::now().duration_since(modified).ok())
                        .map(|age| age > Duration::from_secs(30))
                        .unwrap_or(false);
                    if stale {
                        match fs::remove_dir_all(&path) {
                            Ok(()) => continue,
                            Err(error) if error.kind() == ErrorKind::NotFound => continue,
                            Err(_) => {}
                        }
                    }
                    if started.elapsed() >= Duration::from_secs(45) {
                        return Err(PatchError::ManifestInvalid(format!(
                            "timed out waiting for the instrumented-copy cache lock {}",
                            path.display()
                        )));
                    }
                    std::thread::sleep(std::time::Duration::from_millis(25));
                }
                Err(error) => return Err(error.into()),
            }
        }
    }
}

impl Drop for CacheLock {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Release);
        if let Some(heartbeat) = self.heartbeat.take() {
            heartbeat.thread().unpark();
            let _ = heartbeat.join();
        }
        // A stale owner may wake after another process has reclaimed the lock.
        // It must never delete the new owner's directory on its way out.
        if fs::read_to_string(self.path.join("owner"))
            .map(|owner| owner == self.token)
            .unwrap_or(false)
        {
            let _ = fs::remove_dir_all(&self.path);
        }
    }
}

fn rust_toolchain(project: &Path) -> Result<String, PatchError> {
    let rustc = std::env::var_os("RUSTC").unwrap_or_else(|| "rustc".into());
    // `rustup` chooses a local override from the working directory. Asking in
    // this crate would key the cache with Termwright's compiler instead of the
    // one that will compile the user's application.
    let output = Command::new(rustc)
        .arg("-vV")
        .current_dir(project)
        .output()?;
    if !output.status.success() {
        return Err(PatchError::ManifestInvalid(format!(
            "rustc -vV failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        )));
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_owned())
}

fn host_from(toolchain: &str) -> String {
    toolchain
        .lines()
        .find_map(|line| line.strip_prefix("host: "))
        .unwrap_or("unknown-host")
        .to_owned()
}

fn feature_fingerprint(project: &Path, resolved: &[MetadataPackage]) -> Result<String, PatchError> {
    let mut output = String::new();
    for resolved_package in resolved {
        let package = format!("{}@{}", resolved_package.name, resolved_package.version);
        let mut command = Command::new(cargo_command());
        command.args([
            "tree",
            "--edges",
            "features",
            "--package",
            &package,
            "--depth",
            "0",
            "--prefix",
            "none",
            "--charset",
            "ascii",
            "--color",
            "never",
            "--format",
            "{f}",
        ]);
        if let Some(target) = std::env::var_os("CARGO_BUILD_TARGET") {
            command.arg("--target").arg(target);
        }
        let result = command.current_dir(project).output()?;
        if !result.status.success() {
            return Err(PatchError::ManifestInvalid(format!(
                "cargo tree could not determine enabled features for {package}: {}",
                String::from_utf8_lossy(&result.stderr).trim()
            )));
        }
        output.push_str(&package);
        output.push('\0');
        output.push_str(String::from_utf8_lossy(&result.stdout).trim());
        output.push('\0');
    }
    Ok(format!("sha256:{}", sha256_hex(output.as_bytes())))
}

fn cargo_command() -> std::ffi::OsString {
    std::env::var_os("CARGO").unwrap_or_else(|| "cargo".into())
}

/// Directory containing the lockfile Cargo will use for this project.
fn cargo_workspace_root(project: &Path) -> Result<PathBuf, PatchError> {
    let output = Command::new(cargo_command())
        .args(["locate-project", "--workspace", "--message-format", "plain"])
        .current_dir(project)
        .output()?;
    if !output.status.success() {
        return Err(PatchError::ManifestInvalid(format!(
            "cargo could not locate the workspace for {}: {}",
            project.display(),
            String::from_utf8_lossy(&output.stderr).trim()
        )));
    }
    let manifest = PathBuf::from(String::from_utf8_lossy(&output.stdout).trim());
    manifest.parent().map(Path::to_path_buf).ok_or_else(|| {
        PatchError::ManifestInvalid(format!(
            "cargo returned a workspace manifest without a parent: {}",
            manifest.display()
        ))
    })
}

fn cargo_project_manifest(project: &Path) -> Result<PathBuf, PatchError> {
    let output = Command::new(cargo_command())
        .args(["locate-project", "--message-format", "plain"])
        .current_dir(project)
        .output()?;
    if !output.status.success() {
        return Err(PatchError::ManifestInvalid(format!(
            "cargo could not locate the package manifest for {}: {}",
            project.display(),
            String::from_utf8_lossy(&output.stderr).trim()
        )));
    }
    Ok(PathBuf::from(
        String::from_utf8_lossy(&output.stdout).trim(),
    ))
}

/// Where a patch set for one crate and version lives.
pub fn patch_set_dir(name: &str, version: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("upstream-patches")
        .join(name)
        .join(version)
}

/// Which versions the project actually resolves to.
///
/// Asked of cargo rather than guessed from the manifest: a caret requirement
/// says what is acceptable, and only the lockfile says what is being built.
fn resolve_versions(
    project: &Path,
    project_manifest: &Path,
    use_workspace_default_members: bool,
) -> Result<Vec<MetadataPackage>, PatchError> {
    let output = Command::new(cargo_command())
        .args(["metadata", "--format-version", "1"])
        .current_dir(project)
        .output()?;
    if !output.status.success() {
        return Err(PatchError::ManifestInvalid(format!(
            "cargo metadata failed in {}: {}",
            project.display(),
            String::from_utf8_lossy(&output.stderr).trim()
        )));
    }
    select_patched_packages(
        &String::from_utf8_lossy(&output.stdout),
        project_manifest,
        use_workspace_default_members,
    )
}

fn select_patched_packages(
    metadata: &str,
    project_manifest: &Path,
    use_workspace_default_members: bool,
) -> Result<Vec<MetadataPackage>, PatchError> {
    let packages = read_reachable_metadata_packages(
        metadata,
        project_manifest,
        use_workspace_default_members,
    )?;
    let mut found = Vec::new();
    for name in PATCHED_CRATES {
        let mut matches = packages.iter().filter(|package| package.name == name);
        if let Some(package) = matches.next() {
            if let Some(other) = matches.next() {
                return Err(PatchError::ManifestInvalid(format!(
                    "the dependency graph contains multiple {name} versions ({} and {}); one Cargo patch cannot instrument both safely",
                    package.version, other.version
                )));
            }
            found.push(package.clone());
        }
    }
    let mut framework_matches = packages
        .iter()
        .filter(|package| package.name == FRAMEWORK_CRATE);
    if let Some(package) = framework_matches.next() {
        if let Some(other) = framework_matches.next() {
            return Err(PatchError::ManifestInvalid(format!(
                "the dependency graph contains multiple {FRAMEWORK_CRATE} versions ({} and {}); the handshake version would be ambiguous",
                package.version, other.version
            )));
        }
        found.push(package.clone());
    }
    Ok(found)
}

fn same_filesystem_path(left: &Path, right: &Path) -> bool {
    match (fs::canonicalize(left), fs::canonicalize(right)) {
        (Ok(left), Ok(right)) => left == right,
        _ => left == right,
    }
}

fn require_crates_io_source(package: &MetadataPackage) -> Result<(), PatchError> {
    const CRATES_IO: &str = "registry+https://github.com/rust-lang/crates.io-index";
    if package.source.as_deref() == Some(CRATES_IO) {
        return Ok(());
    }
    Err(PatchError::ManifestInvalid(format!(
        "{} {} comes from {}, but this launcher can only patch crates.io dependencies",
        package.name,
        package.version,
        package.source.as_deref().unwrap_or("a path or workspace")
    )))
}

/// The crate as the registry unpacked it, if it is there.
fn ensure_unpacked_source(
    package: &MetadataPackage,
    project: &Path,
) -> Result<PathBuf, PatchError> {
    if let Some(source) = package.manifest_path.parent().filter(|path| path.is_dir()) {
        return Ok(source.to_path_buf());
    }

    // A clean CI runner must not need a ceremonial plain build first. Cargo
    // retains the caller's own offline/vendor/network policy; this only asks it
    // to materialise the dependency metadata already resolved above.
    let fetched = Command::new(cargo_command())
        .arg("fetch")
        .current_dir(project)
        .output()?;
    if !fetched.status.success() {
        return Err(PatchError::ManifestInvalid(format!(
            "{} {} is not unpacked and cargo fetch failed: {}",
            package.name,
            package.version,
            String::from_utf8_lossy(&fetched.stderr).trim()
        )));
    }
    package
        .manifest_path
        .parent()
        .filter(|path| path.is_dir())
        .map(Path::to_path_buf)
        .ok_or_else(|| {
            PatchError::ManifestInvalid(format!(
                "cargo fetch succeeded but {} {} is still absent at {}",
                package.name,
                package.version,
                package.manifest_path.display()
            ))
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn versions_are_read_out_of_cargo_metadata() {
        // The dependency summary comes first on purpose. The old text scan
        // mistook it for the package and returned core's 0.1.2 for widgets.
        let metadata = r#"{"packages":[
          {"id":"app 0.1.0","name":"ratatui","version":"0.30.0","source":null,
           "manifest_path":"/app/Cargo.toml","dependencies":[
             {"name":"ratatui-widgets","version":"wrong"}]},
          {"id":"core 0.1.2","name":"ratatui-core","version":"0.1.2",
           "source":"registry+https://github.com/rust-lang/crates.io-index",
           "manifest_path":"/registry/ratatui-core-0.1.2/Cargo.toml"},
          {"id":"widgets 0.3.2","name":"ratatui-widgets","version":"0.3.2",
           "source":"registry+https://github.com/rust-lang/crates.io-index",
           "manifest_path":"/registry/ratatui-widgets-0.3.2/Cargo.toml"}],
          "resolve":{"nodes":[
            {"id":"app 0.1.0","dependencies":["core 0.1.2","widgets 0.3.2"]},
            {"id":"core 0.1.2","dependencies":[]},
            {"id":"widgets 0.3.2","dependencies":[]}
          ]}}"#;
        let resolved = select_patched_packages(metadata, Path::new("/app/Cargo.toml"), false)
            .expect("metadata");
        assert_eq!(resolved[0].name, "ratatui-core");
        assert_eq!(resolved[0].version, "0.1.2");
        assert_eq!(resolved[1].name, "ratatui-widgets");
        assert_eq!(resolved[1].version, "0.3.2");
        assert_eq!(resolved[2].name, "ratatui");
        assert_eq!(resolved[2].version, "0.30.0");
    }

    #[test]
    fn ambiguous_framework_versions_are_refused() {
        let metadata = r#"{"packages":[
          {"id":"app","name":"app","version":"0.1.0","source":null,
           "manifest_path":"/app/Cargo.toml"},
          {"id":"one","name":"ratatui-core","version":"0.1.1","source":null,
           "manifest_path":"/one/Cargo.toml"},
          {"id":"two","name":"ratatui-core","version":"0.1.2","source":null,
           "manifest_path":"/two/Cargo.toml"}],
          "resolve":{"nodes":[
            {"id":"app","dependencies":["one","two"]},
            {"id":"one","dependencies":[]},
            {"id":"two","dependencies":[]}
          ]}}"#;
        let error = select_patched_packages(metadata, Path::new("/app/Cargo.toml"), false)
            .expect_err("ambiguous graph");
        assert!(error.to_string().contains("multiple ratatui-core versions"));
    }

    #[test]
    fn a_project_without_a_lockfile_has_its_generated_lock_removed() {
        let empty = std::env::temp_dir().join(format!("tw-nolock-{}", std::process::id()));
        fs::create_dir_all(&empty).expect("temp dir");
        {
            let _guard = LockGuard::save(&empty).expect("save");
            fs::write(empty.join("Cargo.lock"), b"generated\n").expect("generated lock");
        }
        assert!(!empty.join("Cargo.lock").exists());
        let _ = fs::remove_dir_all(&empty);
    }

    #[test]
    fn the_guard_puts_the_bytes_back() {
        let dir = std::env::temp_dir().join(format!("tw-lock-{}", std::process::id()));
        fs::create_dir_all(&dir).expect("temp dir");
        let lock = dir.join("Cargo.lock");
        fs::write(&lock, b"original\n").expect("write");

        let mut guard = LockGuard::save(&dir).expect("save");
        fs::write(&lock, b"rewritten by a patched build\n").expect("write");
        guard.restore().expect("restore");
        assert_eq!(fs::read(&lock).expect("read"), b"original\n");

        // And again, for the caller who both restores and drops.
        guard.restore().expect("idempotent");
        assert_eq!(fs::read(&lock).expect("read"), b"original\n");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn dropping_the_guard_restores_too() {
        let dir = std::env::temp_dir().join(format!("tw-lockdrop-{}", std::process::id()));
        fs::create_dir_all(&dir).expect("temp dir");
        let lock = dir.join("Cargo.lock");
        fs::write(&lock, b"original\n").expect("write");
        {
            let _guard = LockGuard::save(&dir).expect("save");
            fs::write(&lock, b"rewritten\n").expect("write");
        }
        assert_eq!(fs::read(&lock).expect("read"), b"original\n");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_workspace_member_protects_the_root_lockfile() {
        let root = std::env::temp_dir().join(format!("tw-workspace-lock-{}", std::process::id()));
        let member = root.join("member");
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(member.join("src")).expect("member src");
        fs::write(
            root.join("Cargo.toml"),
            "[workspace]\nmembers = [\"member\"]\nresolver = \"2\"\n",
        )
        .expect("workspace manifest");
        fs::write(
            member.join("Cargo.toml"),
            "[package]\nname = \"member\"\nversion = \"0.1.0\"\nedition = \"2021\"\n",
        )
        .expect("member manifest");
        fs::write(member.join("src/lib.rs"), "").expect("member source");
        fs::write(root.join("Cargo.lock"), b"original workspace lock\n").expect("lock");

        let located = cargo_workspace_root(&member).expect("locate workspace");
        assert_eq!(
            fs::canonicalize(&located).expect("located root"),
            fs::canonicalize(&root).expect("expected root")
        );
        {
            let _guard = LockGuard::save(&located).expect("save root lock");
            fs::write(root.join("Cargo.lock"), b"rewritten\n").expect("rewrite root lock");
        }
        assert_eq!(
            fs::read(root.join("Cargo.lock")).expect("restored lock"),
            b"original workspace lock\n"
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn every_relevant_input_changes_the_copy_key() {
        let base = [
            "framework",
            "1.0",
            "source",
            "probe",
            "toolchain",
            "target",
            "features",
            "patch",
            "path",
        ];
        let key = |parts: [&str; 9]| {
            copy_key(&CacheKeyInput {
                framework: parts[0],
                framework_version: parts[1],
                source_digest: parts[2],
                probe_version: parts[3],
                toolchain: parts[4],
                target: parts[5],
                features: parts[6],
                patch_digest: parts[7],
                probe_path: parts[8],
            })
        };
        let original = key(base);
        for index in 0..base.len() {
            let mut changed = base;
            changed[index] = "different";
            assert_ne!(
                key(changed),
                original,
                "field {index} was missing from the key"
            );
        }
    }

    #[test]
    fn a_cache_hit_revalidates_the_copy_contents() {
        let copy = std::env::temp_dir().join(format!("tw-cache-integrity-{}", std::process::id()));
        let _ = fs::remove_dir_all(&copy);
        fs::create_dir_all(&copy).expect("copy");
        fs::write(copy.join("source.rs"), "original\n").expect("source");
        let digest = digest_cache_contents(&copy).expect("digest");
        fs::write(
            copy.join(".termwright-complete"),
            format!("key\n{digest}\n"),
        )
        .expect("stamp");
        assert!(cache_entry_complete(&copy, "key"));

        fs::write(copy.join("source.rs"), "tampered\n").expect("tamper");
        assert!(!cache_entry_complete(&copy, "key"));
        let _ = fs::remove_dir_all(copy);
    }

    #[test]
    fn an_old_owner_cannot_remove_a_reclaimed_cache_lock() {
        let path = std::env::temp_dir().join(format!("tw-cache-owner-{}", std::process::id()));
        let _ = fs::remove_dir_all(&path);
        fs::create_dir_all(&path).expect("lock");
        fs::write(path.join("owner"), "new-owner").expect("new owner");
        let old = CacheLock {
            path: path.clone(),
            token: "old-owner".to_owned(),
            stop: Arc::new(AtomicBool::new(false)),
            heartbeat: None,
        };
        drop(old);
        assert!(path.is_dir());
        let _ = fs::remove_dir_all(path);
    }
}
