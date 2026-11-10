param(
    [string]$EvidenceFile = '.local/app-evidence.json',
    [ValidateRange(1, 120)][int]$DurationMinutes = 70,
    [ValidateRange(5, 25)][int]$IntervalSeconds = 20
)
$ErrorActionPreference = 'Stop'
$deadline = [DateTime]::UtcNow.AddMinutes($DurationMinutes)
$count = 0
try {
    while ([DateTime]::UtcNow -lt $deadline) {
        $tick = [DateTime]::UtcNow
        # Fail closed when the app has exited or stopped publishing current evidence.
        $sample = Get-Content -Raw -LiteralPath $EvidenceFile | ConvertFrom-Json
        $age = ([DateTime]::UtcNow - [DateTime]::Parse($sample.at).ToUniversalTime()).TotalSeconds
        if ($age -lt 0 -or $age -gt 30) { throw 'App evidence is not current' }
        & (Join-Path $PSScriptRoot 'sample-hardware.ps1') -EvidenceFile $EvidenceFile
        $count++
        $remainingMs = [math]::Min(($deadline - [DateTime]::UtcNow).TotalMilliseconds, ($tick.AddSeconds($IntervalSeconds) - [DateTime]::UtcNow).TotalMilliseconds)
        if ($remainingMs -gt 0) { Start-Sleep -Milliseconds ([int]$remainingMs) }
    }
    [pscustomobject]@{ completed = $true; sampleCount = $count } | ConvertTo-Json -Compress
} catch {
    # Do not echo arbitrary paths, source evidence, exceptions or page data.
    [pscustomobject]@{ completed = $false; sampleCount = $count; reason = 'hardware-or-current-app-evidence-unavailable' } | ConvertTo-Json -Compress
    exit 1
}
