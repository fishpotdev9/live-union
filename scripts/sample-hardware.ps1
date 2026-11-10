param([string]$EvidenceFile = '.local/app-evidence.json')
$ErrorActionPreference = 'Stop'
$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$outputDirectory = Join-Path $projectRoot '.local/hardware'
New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null
$evidence = Get-Content -Raw -LiteralPath $EvidenceFile | ConvertFrom-Json
$appIds = @{}
foreach ($metric in $evidence.processes) { $appIds[[int]$metric.pid] = $true }
$engines = @()
foreach ($counter in (Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine)) {
    if ($counter.Name -match '^pid_([0-9]+)_.*_engtype_([A-Za-z0-9]+)$') {
        $processNumber = [int]$Matches[1]
        $engineType = $Matches[2]
        if ($appIds.ContainsKey($processNumber) -and $engineType -in @('VideoDecode', 'VideoProcessing', '3D', 'Copy')) {
            $engines += [pscustomobject]@{ pid = $processNumber; engine = $engineType; utilizationPercent = [double]$counter.UtilizationPercentage }
        }
    }
}
$systemCpu = Get-CimInstance Win32_PerfFormattedData_PerfOS_Processor | Where-Object Name -eq '_Total'
if ($null -eq $systemCpu -or $null -eq $systemCpu.PercentProcessorTime) { throw 'System CPU sample is unavailable' }
$adapters = @(Get-NetAdapter -Physical | Where-Object Status -eq 'Up')
$firstBytes = @($adapters | Get-NetAdapterStatistics)
$started = Get-Date
Start-Sleep -Milliseconds 1200
$secondBytes = @($adapters | Get-NetAdapterStatistics)
$seconds = ((Get-Date) - $started).TotalSeconds
$received = ($secondBytes | Measure-Object -Property ReceivedBytes -Sum).Sum - ($firstBytes | Measure-Object -Property ReceivedBytes -Sum).Sum
$sent = ($secondBytes | Measure-Object -Property SentBytes -Sum).Sum - ($firstBytes | Measure-Object -Property SentBytes -Sum).Sum
$report = [pscustomobject]@{
    at = (Get-Date).ToUniversalTime().ToString('o')
    sourceSampleAt = $evidence.at
    sourceSha256 = $evidence.sourceSha256
    roomCount = $evidence.rooms.Count
    systemCpuPercent = [double]$systemCpu.PercentProcessorTime
    appGpuEngines = $engines
    network = [pscustomobject]@{
        scope = 'whole machine active physical interfaces; includes unrelated applications'
        interfaceCount = $adapters.Count
        intervalSeconds = $seconds
        receivedMbps = [math]::Max(0, $received * 8 / $seconds / 1000000)
        sentMbps = [math]::Max(0, $sent * 8 / $seconds / 1000000)
    }
    perStreamHardwareDecodeVerified = $false
}
$filename = Join-Path $outputDirectory ((Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH-mm-ss-fffZ') + '.json')
$report | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $filename -Encoding utf8
[pscustomobject]@{roomCount=$report.roomCount;systemCpuPercent=$report.systemCpuPercent;videoDecodePercent=($engines | Where-Object engine -eq 'VideoDecode' | Measure-Object utilizationPercent -Sum).Sum;receivedMbps=$report.network.receivedMbps} | ConvertTo-Json -Compress
