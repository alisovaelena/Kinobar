# Открывает меню на всех телевизорах: по одному окну Chrome в режиме киоска на каждый монитор.
# Порядок: монитор 1 -> /screen/1, монитор 2 -> /screen/2 и т.д. (слева направо).
param(
  [string]$Server = "http://localhost:3000",
  [string]$Chrome = ""
)

Add-Type -AssemblyName System.Windows.Forms

if (-not $Chrome) {
  $candidates = @(
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
    "$env:LocalAppData\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
    "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe"
  )
  $Chrome = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
}
if (-not $Chrome) { Write-Error "Не найден Chrome или Edge"; exit 1 }

# Ждём, пока сервер запустится.
for ($i = 0; $i -lt 60; $i++) {
  try { Invoke-WebRequest "$Server/api/menu" -UseBasicParsing -TimeoutSec 2 | Out-Null; break } catch { Start-Sleep 1 }
}

# Мониторы слева направо, сверху вниз.
$screens = [System.Windows.Forms.Screen]::AllScreens | Sort-Object { $_.Bounds.X }, { $_.Bounds.Y }
$n = 1
foreach ($s in $screens) {
  $b = $s.Bounds
  $dataDir = Join-Path $env:TEMP "kinobar-tv-$n"
  Start-Process $Chrome -ArgumentList @(
    "--user-data-dir=`"$dataDir`"",
    "--window-position=$($b.X),$($b.Y)",
    "--window-size=$($b.Width),$($b.Height)",
    "--kiosk",
    "--noerrdialogs",
    "--disable-session-crashed-bubble",
    "--disable-infobars",
    "--autoplay-policy=no-user-gesture-required",
    "--no-first-run",
    "$Server/screen/$n"
  )
  Write-Host "ТВ $n -> монитор $($b.X),$($b.Y) $($b.Width)x$($b.Height)"
  $n++
  Start-Sleep -Milliseconds 800
}
