# PowerShell equivalent of infra/piston/scripts/install-packages.sh
# Run from Mock-Placement-App-updated, in PowerShell, once the stack is up.

$BaseUrl = "http://localhost:2000"

$Packages = @(
    @{ lang = "python";  ver = "3.10.0" },
    @{ lang = "node";    ver = "18.15.0" },
    @{ lang = "java";    ver = "15.0.2" },
    @{ lang = "gcc";     ver = "10.2.0" },
    @{ lang = "go";      ver = "1.16.2" },
    @{ lang = "ruby";    ver = "3.0.1" },
    @{ lang = "rust";    ver = "1.68.2" },
    @{ lang = "kotlin";  ver = "1.8.20" },
    @{ lang = "sqlite3"; ver = "3.36.0" }
)

Write-Host "Installing $($Packages.Count) Piston language packages via $BaseUrl..."

foreach ($pkg in $Packages) {
    Write-Host "==> installing $($pkg.lang)=$($pkg.ver)"
    $body = @{ language = $pkg.lang; version = $pkg.ver } | ConvertTo-Json
    $attempt = 1
    $maxAttempts = 3
    $done = $false
    while (-not $done -and $attempt -le $maxAttempts) {
        try {
            $response = Invoke-WebRequest -Uri "$BaseUrl/api/v2/packages" -Method Post -Body $body -ContentType "application/json" -UseBasicParsing
            if ($response.StatusCode -eq 200) {
                Write-Host "    OK"
                $done = $true
            }
        } catch {
            if ($_.Exception.Response -and $_.Exception.Response.StatusCode -eq 200) {
                $done = $true
            } elseif ($attempt -lt $maxAttempts) {
                Write-Host "    attempt $attempt/$maxAttempts failed, retrying..."
                Start-Sleep -Seconds 3
            } else {
                Write-Host "    FAILED after $maxAttempts attempts: $($_.Exception.Message)"
            }
        }
        $attempt++
    }
}

Write-Host ""
Write-Host "Restarting piston1/piston2/piston3 so every replica picks up the new packages..."
docker restart pp_piston1 pp_piston2 pp_piston3 | Out-Null

Write-Host "Waiting for replicas to become healthy again..."
foreach ($c in @("pp_piston1", "pp_piston2", "pp_piston3")) {
    do {
        Start-Sleep -Seconds 1
        $status = docker inspect -f '{{.State.Health.Status}}' $c 2>$null
    } while ($status -ne "healthy")
}

Write-Host ""
Write-Host "Done."
