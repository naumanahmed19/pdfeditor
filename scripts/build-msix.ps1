[CmdletBinding()]
param(
  [string]$PackageIdentityName = "Xvelopers.PickPDF",
  [string]$Publisher = "CN=PickPDF Test Code Signing",
  [string]$PublisherDisplayName = "Xvelopers",
  [string]$CertificateThumbprint = "26C4327DF20F7C0C47FEE004F22FB1ABF13662CD",
  [switch]$SkipTauriBuild,
  [switch]$Unsigned
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Get-FullPath([string]$Path) {
  return [System.IO.Path]::GetFullPath($Path)
}

function Assert-UnderRoot([string]$Path, [string]$Root) {
  $fullPath = Get-FullPath $Path
  $fullRoot = (Get-FullPath $Root).TrimEnd('\') + '\'

  if (-not $fullPath.StartsWith($fullRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to use path outside repository: $fullPath"
  }

  return $fullPath
}

function Get-LatestWindowsSdkTool([string]$ToolName) {
  $kitsRoot = Join-Path ${env:ProgramFiles(x86)} "Windows Kits\10\bin"

  $tool = Get-ChildItem -LiteralPath $kitsRoot -Recurse -Filter $ToolName -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -match "\\x64\\$([regex]::Escape($ToolName))$" } |
    Sort-Object FullName -Descending |
    Select-Object -First 1

  if (-not $tool) {
    throw "Could not find $ToolName in the Windows SDK. Install the Windows SDK or Microsoft WinApp CLI."
  }

  return $tool.FullName
}

function Convert-ToMsixVersion([string]$Version) {
  if ($Version -match '^\d+\.\d+\.\d+\.\d+$') {
    return $Version
  }

  if ($Version -match '^\d+\.\d+\.\d+$') {
    return "$Version.0"
  }

  throw "MSIX requires a numeric version like 1.2.3.4. Current version: $Version"
}

function Escape-Xml([string]$Value) {
  return [System.Security.SecurityElement]::Escape($Value)
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Resolve-Path (Join-Path $scriptDir "..")
$repoRootPath = $repoRoot.Path

$tauriConfigPath = Join-Path $repoRootPath "src-tauri\tauri.conf.json"
$tauriConfig = Get-Content -LiteralPath $tauriConfigPath -Raw | ConvertFrom-Json
$productName = [string]$tauriConfig.productName
$msixVersion = Convert-ToMsixVersion ([string]$tauriConfig.version)

$outDir = Join-Path $repoRootPath "src-tauri\target\msix"
$stageDir = Join-Path $outDir "stage"
$assetsDir = Join-Path $stageDir "Assets"

Assert-UnderRoot $outDir $repoRootPath | Out-Null
Assert-UnderRoot $stageDir $repoRootPath | Out-Null

if (-not $SkipTauriBuild) {
  Push-Location $repoRootPath
  try {
    & bun run tauri build --no-bundle
    if ($LASTEXITCODE -ne 0) {
      throw "Tauri release build failed with exit code $LASTEXITCODE"
    }
  }
  finally {
    Pop-Location
  }
}

$releaseExe = Join-Path $repoRootPath "src-tauri\target\release\app.exe"
if (-not (Test-Path -LiteralPath $releaseExe)) {
  throw "Release executable not found: $releaseExe"
}

if (Test-Path -LiteralPath $stageDir) {
  Remove-Item -LiteralPath $stageDir -Recurse -Force
}

New-Item -ItemType Directory -Force -Path $assetsDir | Out-Null
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

$packagedExeName = "$productName.exe"
Copy-Item -LiteralPath $releaseExe -Destination (Join-Path $stageDir $packagedExeName) -Force

$iconDir = Join-Path $repoRootPath "src-tauri\icons"
$assetNames = @(
  "StoreLogo.png",
  "Square44x44Logo.png",
  "Square71x71Logo.png",
  "Square150x150Logo.png",
  "Square310x310Logo.png"
)

foreach ($assetName in $assetNames) {
  $source = Join-Path $iconDir $assetName
  if (-not (Test-Path -LiteralPath $source)) {
    throw "Missing MSIX asset: $source"
  }

  Copy-Item -LiteralPath $source -Destination (Join-Path $assetsDir $assetName) -Force
}

$manifestPath = Join-Path $stageDir "AppxManifest.xml"
$manifest = @"
<?xml version="1.0" encoding="utf-8"?>
<Package
  xmlns="http://schemas.microsoft.com/appx/manifest/foundation/windows10"
  xmlns:uap="http://schemas.microsoft.com/appx/manifest/uap/windows10"
  xmlns:rescap="http://schemas.microsoft.com/appx/manifest/foundation/windows10/restrictedcapabilities"
  IgnorableNamespaces="uap rescap">
  <Identity
    Name="$(Escape-Xml $PackageIdentityName)"
    Publisher="$(Escape-Xml $Publisher)"
    Version="$(Escape-Xml $msixVersion)"
    ProcessorArchitecture="x64" />
  <Properties>
    <DisplayName>$(Escape-Xml $productName)</DisplayName>
    <PublisherDisplayName>$(Escape-Xml $PublisherDisplayName)</PublisherDisplayName>
    <Logo>Assets\StoreLogo.png</Logo>
  </Properties>
  <Dependencies>
    <TargetDeviceFamily Name="Windows.Desktop" MinVersion="10.0.19041.0" MaxVersionTested="10.0.26100.0" />
  </Dependencies>
  <Resources>
    <Resource Language="en-us" />
  </Resources>
  <Applications>
    <Application Id="PickPDF" Executable="$(Escape-Xml $packagedExeName)" EntryPoint="Windows.FullTrustApplication">
      <uap:VisualElements
        DisplayName="$(Escape-Xml $productName)"
        Description="PickPDF PDF editor"
        BackgroundColor="transparent"
        Square150x150Logo="Assets\Square150x150Logo.png"
        Square44x44Logo="Assets\Square44x44Logo.png" />
    </Application>
  </Applications>
  <Capabilities>
    <rescap:Capability Name="runFullTrust" />
  </Capabilities>
</Package>
"@
Set-Content -LiteralPath $manifestPath -Value $manifest -Encoding UTF8

$makeAppx = Get-LatestWindowsSdkTool "makeappx.exe"
$signtool = Get-LatestWindowsSdkTool "signtool.exe"
$msixPath = Join-Path $outDir "$($productName)_$($msixVersion)_x64.msix"

if (Test-Path -LiteralPath $msixPath) {
  Remove-Item -LiteralPath $msixPath -Force
}

& $makeAppx pack /d $stageDir /p $msixPath /overwrite
if ($LASTEXITCODE -ne 0) {
  throw "makeappx.exe failed with exit code $LASTEXITCODE"
}

if (-not $Unsigned) {
  & $signtool sign /fd SHA256 /sha1 $CertificateThumbprint /tr "http://timestamp.digicert.com" /td SHA256 $msixPath
  if ($LASTEXITCODE -ne 0) {
    throw "signtool.exe failed with exit code $LASTEXITCODE"
  }
}

$signature = Get-AuthenticodeSignature -LiteralPath $msixPath

Write-Host ""
Write-Host "MSIX package:"
Write-Host "  $msixPath"
Write-Host ""
Write-Host "Signature status:"
Write-Host "  $($signature.Status)"
Write-Host "  $($signature.StatusMessage)"

if ($Unsigned) {
  Write-Host ""
  Write-Host "Unsigned package created. For Microsoft Store submission, replace PackageIdentityName and Publisher with the exact Partner Center values."
}
