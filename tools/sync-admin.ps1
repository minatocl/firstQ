# minato-call : download the latest reception panel (admin.html) from GitHub Pages
# into <this script folder>\public\admin.html, with validation.
# Placed on this PC as C:\minato-call\server\sync-admin.ps1 by the setup .bat,
# then run every 10 min by a Scheduled Task. Keeps 8787 always up to date.
$ErrorActionPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$Url  = 'https://minatocl.github.io/firstQ/admin.html'
$Dest = Join-Path $PSScriptRoot 'public\admin.html'
$Tmp  = "$Dest.tmp"
try {
    Invoke-WebRequest -Uri $Url -OutFile $Tmp -UseBasicParsing -TimeoutSec 20
    $h = Get-Content -LiteralPath $Tmp -Raw
    # keep only if it looks like the real panel (size + ASCII marker, encoding-safe)
    if ($h.Length -gt 10000 -and $h.Contains('minato-monshin')) {
        Move-Item -LiteralPath $Tmp -Destination $Dest -Force
        Write-Host ("[sync] admin.html updated {0} bytes {1}" -f $h.Length, (Get-Date))
    } else {
        Remove-Item -LiteralPath $Tmp -Force
        Write-Warning '[sync] invalid content, kept existing admin.html'
    }
} catch {
    if (Test-Path $Tmp) { Remove-Item $Tmp -Force }
    Write-Warning ('[sync] failed: ' + $_.Exception.Message)
}
