$Clean = $false
if ($args -contains "-Clean") {
  $Clean = $true
}

$ErrorActionPreference = "Stop"

$vswhere = "C:\Program Files (x86)\Microsoft Visual Studio\Installer\vswhere.exe"

if (-not (Test-Path $vswhere)) {
  throw "vswhere.exe not found. Install Visual Studio Build Tools with Desktop development with C++."
}

$installationPath = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath

if (-not $installationPath) {
  throw "Visual C++ build tools not found."
}

$vcvars = Join-Path $installationPath "VC\Auxiliary\Build\vcvars64.bat"

if (-not (Test-Path $vcvars)) {
  throw "vcvars64.bat not found at $vcvars"
}

if ($Clean) {
  & cmd.exe /c "call `"$vcvars`" && cd /d src-tauri && cargo clean"
  if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
  }
}

& cmd.exe /c "call `"$vcvars`" && set `"CARGO_BUILD_JOBS=1`" && npm run tauri build"
exit $LASTEXITCODE
