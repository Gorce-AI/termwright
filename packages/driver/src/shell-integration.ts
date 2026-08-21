/** Establishes an exact initial prompt for a POSIX shell opened by Termwright. */
export function posixShellBootstrap(): string {
  return "printf '\\033]133;A\\007\\033]133;B\\007'\r";
}

/** Wraps one POSIX command without parsing its output or prompt text. */
export function wrapPosixShellCommand(command: string): string {
  const quoted = command.replaceAll("'", "'\\''");
  return (
    "printf '\\033]133;C\\007'; " +
    `eval '${quoted}'; ` +
    "__termwright_status=$?; " +
    "printf '\\033]133;D;%s\\007\\033]7;file://localhost%s\\007\\033]133;A\\007\\033]133;B\\007' " +
    '"$__termwright_status" "$PWD"; unset __termwright_status'
  );
}

/** Establishes an exact initial prompt for a PowerShell opened by Termwright. */
export function powershellBootstrap(): string {
  return '[Console]::Write("`e]133;A`a`e]133;B`a")\r';
}

/** Wraps one PowerShell command while preserving its native or cmdlet status. */
export function wrapPowerShellCommand(command: string): string {
  const quoted = command.replaceAll("'", "''");
  return (
    '[Console]::Write("`e]133;C`a"); ' +
    '$global:LASTEXITCODE=$null; ' +
    `& ([scriptblock]::Create('${quoted}')); ` +
    '$__termwright_ok=$?; $__termwright_exit=$LASTEXITCODE; ' +
    '$__termwright_status=if ($null -ne $__termwright_exit) {[int]$__termwright_exit} elseif ($__termwright_ok) {0} else {1}; ' +
    '$__termwright_cwd=[Uri]::EscapeDataString((Get-Location).Path.Replace("\\","/")); ' +
    '[Console]::Write("`e]133;D;$__termwright_status`a`e]7;file://localhost/$__termwright_cwd`a`e]133;A`a`e]133;B`a"); ' +
    'Remove-Variable __termwright_ok,__termwright_exit,__termwright_status,__termwright_cwd -ErrorAction SilentlyContinue'
  );
}
