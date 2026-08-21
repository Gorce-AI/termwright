use std::env;
use std::process::{Command, ExitCode};

use termwright_probe_ratatui::launch::{prepare_instrumented_build, PrepareOptions};

fn main() -> ExitCode {
    match build() {
        Ok(true) => ExitCode::SUCCESS,
        Ok(false) => ExitCode::FAILURE,
        Err(error) => {
            eprintln!("{error}");
            ExitCode::FAILURE
        }
    }
}

fn build() -> Result<bool, Box<dyn std::error::Error>> {
    let project = env::args().nth(1).ok_or("usage: build-tool <app-directory>")?;
    let prepared = prepare_instrumented_build(&PrepareOptions::new(&project))?;
    let mut cargo = Command::new("cargo");
    cargo.args(["build", "--manifest-path"])
        .arg(format!("{project}/Cargo.toml"));
    for config in &prepared.config_args {
        cargo.arg("--config").arg(config);
    }
    for (key, value) in &prepared.env {
        cargo.env(key, value);
    }
    let success = cargo.status()?.success();
    prepared.finish()?;
    Ok(success)
}
