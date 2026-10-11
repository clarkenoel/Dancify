param(
    [ValidateSet('start', 'setup', 'demo')][string]$Mode = 'start',
    [switch]$ResetConfig
)
$ErrorActionPreference = 'Stop'
try {
    if (-not (Get-Command wsl.exe -ErrorAction SilentlyContinue)) {
        throw 'WSL is missing. Install Ubuntu 24.04 using the instructions in LAUNCHER.md.'
    }
    $configDir = Join-Path $env:LOCALAPPDATA 'Dancify'
    $configPath = Join-Path $configDir 'launcher.json'
    if ((Test-Path $configPath) -and -not $ResetConfig) {
        $config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
    } else {
        Write-Host 'Installed WSL distributions:'
        & wsl.exe --list --quiet
        if ($LASTEXITCODE -ne 0) { throw 'Could not list WSL distributions. Install/start WSL first.' }
        $distribution = Read-Host 'WSL distribution name [Ubuntu-24.04]'
        if ([string]::IsNullOrWhiteSpace($distribution)) { $distribution = 'Ubuntu-24.04' }
        $repo = Read-Host 'Linux repository folder [~/projects/justmakeit]'
        if ([string]::IsNullOrWhiteSpace($repo)) { $repo = '~/projects/justmakeit' }
        $config = [pscustomobject]@{ distribution = $distribution; repository = $repo }
    }
    if ([string]::IsNullOrWhiteSpace($config.distribution) -or [string]::IsNullOrWhiteSpace($config.repository)) {
        throw "Invalid configuration. Delete $configPath and launch again."
    }
    # Encode the path as data, never interpolate user input into shell source.
    $repoEncoded = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($config.repository))
    $script = @'
set -eu
repo=$(printf '%s' '__REPO__' | base64 -d)
case "$repo" in '~/'*) repo="$HOME/${repo#\~/}" ;; esac
if [ ! -f "$repo/scripts/start.sh" ] || [ ! -f "$repo/scripts/setup.sh" ]; then
  echo "Dancify checkout not found at: $repo" >&2
  exit 1
fi
cd -- "$repo"
__ACTION__
'@
    function Invoke-DancifyShell([string]$action) {
        $body = $script.Replace('__REPO__', $repoEncoded).Replace('__ACTION__', $action)
        $encoded = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($body.Replace("`r", '')))
        & wsl.exe --distribution $config.distribution --exec bash -lc "printf '%s' '$encoded' | base64 -d | bash" | Out-Host
        return $LASTEXITCODE
    }
    # Only persist configuration after the checkout has been found.
    # Suppress successful check output so this function returns only its exit code.
    $check = Invoke-DancifyShell 'true'
    if ($check -ne 0) { throw "Check your distribution and repository path. To reconfigure, delete $configPath." }
    New-Item -ItemType Directory -Force -Path $configDir | Out-Null
    $config | ConvertTo-Json | Set-Content -LiteralPath $configPath -Encoding UTF8
    Write-Host "Dancify: $($config.distribution) / $($config.repository)"
    # Stream output directly; do not capture the running supervisor's output.
    $action = if ($Mode -eq 'setup') { 'exec bash scripts/setup.sh' } elseif ($Mode -eq 'demo') { 'exec python3 scripts/demo.py' } else { 'exec bash scripts/start.sh' }
    $body = $script.Replace('__REPO__', $repoEncoded).Replace('__ACTION__', $action)
    $encoded = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($body.Replace("`r", '')))
    & wsl.exe --distribution $config.distribution --exec bash -lc "printf '%s' '$encoded' | base64 -d | bash"
    exit $LASTEXITCODE
} catch {
    Write-Host "Dancify could not start: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
