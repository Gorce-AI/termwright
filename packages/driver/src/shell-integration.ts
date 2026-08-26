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

/** Emits the initial prompt boundary as part of PowerShell process startup. */
export function powershellStartupCommand(): string {
  return '[Console]::Write("`e]133;A`a`e]133;B`a")';
}

const SAFE_POWERSHELL_STARTUP_OPTIONS = new Map<string, 0 | 1>([
  ["-nologo", 0],
  ["-noprofile", 0],
  ["-noexit", 0],
  ["-executionpolicy", 1],
  ["-workingdirectory", 1],
]);

/**
 * Makes readiness causal: PowerShell itself emits the first marker before it
 * enters the interactive loop, so no keystroke is raced against PSReadLine.
 */
export function integratedPowerShellCommand(
  command: readonly string[],
): readonly string[] {
  if (command.length === 0)
    throw new TypeError("a PowerShell command needs an executable");
  let hasNoExit = false;
  for (let index = 1; index < command.length; index += 1) {
    const argument = command[index]!;
    const arity = SAFE_POWERSHELL_STARTUP_OPTIONS.get(argument.toLowerCase());
    if (arity === undefined) {
      throw new TypeError(
        `termwright-powershell cannot compose with PowerShell startup argument ${JSON.stringify(argument)}`,
      );
    }
    hasNoExit ||= argument.toLowerCase() === "-noexit";
    if (arity === 0) continue;
    const value = command[index + 1];
    if (value === undefined || value.startsWith("-")) {
      throw new TypeError(
        `PowerShell startup option ${JSON.stringify(argument)} needs a value`,
      );
    }
    index += 1;
  }
  return [
    ...command,
    ...(hasNoExit ? [] : ["-NoExit"]),
    "-Command",
    powershellStartupCommand(),
  ];
}

/** Wraps one PowerShell command while preserving its native or cmdlet status. */
export function wrapPowerShellCommand(command: string): string {
  const quoted = command.replaceAll("'", "''");
  return (
    '[Console]::Write("`e]133;C`a"); ' +
    "$global:LASTEXITCODE=$null; " +
    `& ([scriptblock]::Create('${quoted}')); ` +
    "$__termwright_ok=$?; $__termwright_exit=$LASTEXITCODE; " +
    "$__termwright_status=if ($null -ne $__termwright_exit) {[int]$__termwright_exit} elseif ($__termwright_ok) {0} else {1}; " +
    '$__termwright_cwd=[Uri]::EscapeDataString((Get-Location).Path.Replace("\\","/")); ' +
    '[Console]::Write("`e]133;D;$__termwright_status`a`e]7;file://localhost/$__termwright_cwd`a`e]133;A`a`e]133;B`a"); ' +
    "Remove-Variable __termwright_ok,__termwright_exit,__termwright_status,__termwright_cwd -ErrorAction SilentlyContinue"
  );
}
