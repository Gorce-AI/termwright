//! Internal helper for the repository's upstream candidate certifier.
//!
//! The JavaScript orchestrator owns discovery and evidence. This helper keeps
//! Rust patch application in the crate that already implements it, so the
//! certification path cannot drift into a second unified-diff implementation.

use std::path::Path;

use serde_json::json;
use termwright_probe_ratatui::patchset::{apply, copy_out, digest_patch_set, read_manifest};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let arguments = std::env::args().skip(1).collect::<Vec<_>>();
    if arguments.len() != 4 {
        return Err(
            "usage: upstream_certify <patch-set> <upstream> <copy> <canonical-probe-path>".into(),
        );
    }

    let patch_set = Path::new(&arguments[0]);
    let upstream = Path::new(&arguments[1]);
    let copy = Path::new(&arguments[2]);
    let probe_path = Path::new(&arguments[3]);
    let manifest = read_manifest(&patch_set.join("manifest.json"))?;

    copy_out(upstream, copy)?;
    apply(&manifest, patch_set, copy, probe_path)?;

    let patched = manifest
        .patched
        .iter()
        .map(|file| {
            json!({
                "path": file.path,
                "sha256Before": file.sha256_before,
                "sha256After": file.sha256_after,
            })
        })
        .collect::<Vec<_>>();
    let result = json!({
        "framework": manifest.framework,
        "frameworkVersion": manifest.framework_version,
        "patchSetVersion": manifest.patch_set_version,
        "patchSetDigest": digest_patch_set(patch_set)?,
        "patched": patched,
    });
    println!("{}", serde_json::to_string(&result)?);
    Ok(())
}
