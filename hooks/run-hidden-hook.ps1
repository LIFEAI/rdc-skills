param(
  [Parameter(Mandatory = $true)]
  [string]$HookScript
)

$ErrorActionPreference = "Stop"

$nodeCmd = Get-Command node.exe -ErrorAction SilentlyContinue
if (-not $nodeCmd) {
  $nodeCmd = Get-Command node -ErrorAction SilentlyContinue
}
$node = if ($nodeCmd) { $nodeCmd.Source } else { $null }
if (-not $node) {
  $node = if ($nodeCmd) { $nodeCmd.Path } else { $null }
}
if (-not $node) {
  [Console]::Error.WriteLine("run-hidden-hook: node was not found on PATH")
  exit 127
}

$stdinText = [Console]::In.ReadToEnd()

$psi = [System.Diagnostics.ProcessStartInfo]::new()
$psi.FileName = $node
$psi.UseShellExecute = $false
$psi.CreateNoWindow = $true
$psi.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Hidden
$psi.RedirectStandardInput = $true
$psi.RedirectStandardOutput = $true
$psi.RedirectStandardError = $true
$psi.Arguments = "`"$HookScript`""

$proc = [System.Diagnostics.Process]::new()
$proc.StartInfo = $psi
$null = $proc.Start()

$proc.StandardInput.Write($stdinText)
$proc.StandardInput.Close()

$stdout = $proc.StandardOutput.ReadToEnd()
$stderr = $proc.StandardError.ReadToEnd()
$proc.WaitForExit()

if ($stdout) { [Console]::Out.Write($stdout) }
if ($stderr) { [Console]::Error.Write($stderr) }

exit $proc.ExitCode
