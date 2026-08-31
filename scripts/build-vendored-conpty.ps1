[CmdletBinding()]
param(
    [string] $ManifestPath = "packages/pty/upstream-patches/openconsole/dd494ac79a82a04e1e7252a91c8939a3c3039908/manifest.json",
    [Parameter(Mandatory = $true)]
    [string] $OutputDirectory,
    [string] $SourceArchive
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

if ($env:OS -ne "Windows_NT") {
    throw "The vendored ConPTY bootstrap requires Windows and MSVC."
}

$repositoryRoot = Split-Path -Parent $PSScriptRoot
$manifestFile = [System.IO.Path]::GetFullPath((Join-Path $repositoryRoot $ManifestPath))
$manifest = Get-Content -Raw $manifestFile | ConvertFrom-Json
$patchFile = Join-Path (Split-Path -Parent $manifestFile) $manifest.patch.path
$outputRoot = [System.IO.Path]::GetFullPath($OutputDirectory)

function Get-Sha256([string] $Path) {
    return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Assert-Sha256([string] $Path, [string] $Expected, [string] $Description) {
    $actual = Get-Sha256 $Path
    if ($actual -ne $Expected) {
        throw "$Description SHA-256 mismatch: expected $Expected, got $actual"
    }
}

if ((Test-Path -LiteralPath $outputRoot) -and (Get-ChildItem -Force -LiteralPath $outputRoot | Select-Object -First 1)) {
    throw "OutputDirectory must be absent or empty: $outputRoot"
}
New-Item -ItemType Directory -Force -Path $outputRoot | Out-Null

# NuGet's legacy restore path still uses Win32 MAX_PATH internally. GitHub's
# user-profile temp directory plus the Microsoft Terminal archive root and
# package ids exceeds that limit before MSBuild starts. Keep this throwaway
# source tree at the runner-work drive's short parent; the unique leaf and the
# finally block preserve isolation and cleanup.
$scratchParent = if ($env:RUNNER_TEMP) {
    Split-Path -Parent ([System.IO.Path]::GetFullPath($env:RUNNER_TEMP))
} else {
    [System.IO.Path]::GetTempPath()
}
$scratch = Join-Path $scratchParent ("twc-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $scratch | Out-Null
try {
    $archive = if ($SourceArchive) {
        [System.IO.Path]::GetFullPath($SourceArchive)
    } else {
        Join-Path $scratch "microsoft-terminal.tar.gz"
    }
    if (-not $SourceArchive) {
        Invoke-WebRequest -Uri $manifest.upstream.archiveUrl -OutFile $archive
    }
    Assert-Sha256 $archive $manifest.upstream.archiveSha256 "Microsoft Terminal source archive"
    Assert-Sha256 $patchFile $manifest.patch.sha256 "Termwright OpenConsole patch"

    $extractRoot = Join-Path $scratch "source"
    New-Item -ItemType Directory -Path $extractRoot | Out-Null
    & tar.exe -xzf $archive -C $extractRoot
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to extract the pinned Microsoft Terminal source archive."
    }
    $sourceDirectories = @(Get-ChildItem -Directory -LiteralPath $extractRoot)
    if ($sourceDirectories.Count -ne 1) {
        throw "The source archive did not contain exactly one root directory."
    }
    $sourceRoot = $sourceDirectories[0].FullName

    foreach ($property in $manifest.touchedFiles.PSObject.Properties) {
        $path = Join-Path $sourceRoot $property.Name
        Assert-Sha256 $path $property.Value.sha256Before "Upstream source $($property.Name) before patch"
    }

    Push-Location $sourceRoot
    try {
        # Microsoft Terminal stores these sources with CRLF. GitHub normalizes
        # the patch asset itself to LF, so context matching explicitly ignores
        # only end-of-line whitespace; exact before/after hashes remain the
        # authoritative byte fence.
        & git.exe apply --check --ignore-space-change "-p$($manifest.patch.strip)" $patchFile
        if ($LASTEXITCODE -ne 0) {
            throw "The request-addressed host cursor patch does not apply exactly."
        }
        & git.exe apply --ignore-space-change "-p$($manifest.patch.strip)" $patchFile
        if ($LASTEXITCODE -ne 0) {
            throw "Failed to apply the request-addressed host cursor patch."
        }
    } finally {
        Pop-Location
    }

    foreach ($property in $manifest.touchedFiles.PSObject.Properties) {
        $path = Join-Path $sourceRoot $property.Name
        $text = [System.IO.File]::ReadAllText($path)
        $text = [System.Text.RegularExpressions.Regex]::Replace($text, "\r?\n", "`r`n")
        [System.IO.File]::WriteAllText($path, $text, [System.Text.UTF8Encoding]::new($false))
    }

    foreach ($property in $manifest.touchedFiles.PSObject.Properties) {
        $path = Join-Path $sourceRoot $property.Name
        Assert-Sha256 $path $property.Value.sha256After "Upstream source $($property.Name) after patch"
    }

    $nuget = Join-Path $sourceRoot "dep/nuget/nuget.exe"
    & $nuget restore (Join-Path $sourceRoot "dep/nuget/packages.config") -PackagesDirectory (Join-Path $sourceRoot "packages") -NonInteractive
    if ($LASTEXITCODE -ne 0) { throw "NuGet tool dependency restore failed." }

    $msbuild = (Get-Command msbuild.exe -ErrorAction Stop).Source
    & (Join-Path $sourceRoot "build/scripts/Set-LatestVCToolsVersion.ps1")
    $targetArgument = "/t:" + ($manifest.build.targets -join ";")
    foreach ($platform in $manifest.build.platforms) {
        & $msbuild (Join-Path $sourceRoot $manifest.build.solution) `
            $targetArgument `
            "/m" `
            "/restore" `
            "/p:Configuration=$($manifest.build.configuration)" `
            "/p:Platform=$platform" `
            "/p:GenerateAppxPackageOnBuild=false" `
            "/p:WindowsTerminalOfficialBuild=false"
        if ($LASTEXITCODE -ne 0) {
            throw "OpenConsole/ConPTY build failed for $platform."
        }
    }

    $builtFiles = [ordered]@{}
    foreach ($architecture in @("x64", "arm64")) {
        $architectureRoot = Join-Path $outputRoot $architecture
        New-Item -ItemType Directory -Path $architectureRoot | Out-Null
        foreach ($relativeOutput in $manifest.build.outputs.$architecture) {
            $source = Join-Path $sourceRoot $relativeOutput
            if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
                throw "Expected build output is absent: $relativeOutput"
            }
            $destination = Join-Path $architectureRoot (Split-Path -Leaf $source)
            Copy-Item -LiteralPath $source -Destination $destination
            $builtFiles["$architecture/$(Split-Path -Leaf $source)"] = Get-Sha256 $destination
        }
    }

    Copy-Item -LiteralPath $manifestFile -Destination (Join-Path $outputRoot "source-manifest.json")
    Copy-Item -LiteralPath $patchFile -Destination (Join-Path $outputRoot "host-cursor-rpc.patch")
    Copy-Item -LiteralPath (Join-Path $sourceRoot "LICENSE") -Destination (Join-Path $outputRoot "LICENSE.microsoft-terminal.txt")
    Copy-Item -LiteralPath (Join-Path $sourceRoot "NOTICE.md") -Destination (Join-Path $outputRoot "NOTICE.microsoft-terminal.md")

    $provenance = [ordered]@{
        schemaVersion = 1
        upstreamRepository = $manifest.upstream.repository
        upstreamCommit = $manifest.upstream.commit
        upstreamArchiveSha256 = $manifest.upstream.archiveSha256
        patchSha256 = $manifest.patch.sha256
        buildConfiguration = $manifest.build.configuration
        binaryDigests = $builtFiles
        status = "uncertified-bootstrap-output"
    }
    $provenance | ConvertTo-Json -Depth 8 | Set-Content -Encoding utf8NoBOM (Join-Path $outputRoot "bootstrap-provenance.json")
} finally {
    Remove-Item -LiteralPath $scratch -Recurse -Force
}
