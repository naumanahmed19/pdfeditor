[CmdletBinding()]
param(
  [string]$PackageIdentityName = "XVELOPERS.PickPDFPDFEditor",
  [string]$Publisher = "CN=9051037E-CF67-4FBD-B4FA-F71DD84CBACD",
  [string]$PublisherDisplayName = "XVELOPERS",
  [string]$PackageDisplayName = "PickPDF $([char]0x2013) PDF Editor",
  [string]$CertificateThumbprint = "26C4327DF20F7C0C47FEE004F22FB1ABF13662CD",
  [switch]$SkipTauriBuild,
  [switch]$Unsigned,
  [switch]$StoreUpload
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

if ([string]::IsNullOrWhiteSpace($PackageDisplayName)) {
  $PackageDisplayName = $productName
}

if ($StoreUpload -and $Publisher -eq "CN=PickPDF Test Code Signing") {
  throw "StoreUpload requires the exact Publisher value from Partner Center (Product identity). The test publisher cannot be submitted to the Store."
}

$outDir = Join-Path $repoRootPath "src-tauri\target\msix"
$stageDir = Join-Path $outDir "stage"
$assetsDir = Join-Path $stageDir "Assets"

Assert-UnderRoot $outDir $repoRootPath | Out-Null
Assert-UnderRoot $stageDir $repoRootPath | Out-Null

if (-not $SkipTauriBuild) {
  $hadDistributionChannel = Test-Path Env:\VITE_DISTRIBUTION_CHANNEL
  $previousDistributionChannel = $env:VITE_DISTRIBUTION_CHANNEL
  $env:VITE_DISTRIBUTION_CHANNEL = "microsoft-store"
  Push-Location $repoRootPath
  try {
    & bun run tauri build --no-bundle
    if ($LASTEXITCODE -ne 0) {
      throw "Tauri release build failed with exit code $LASTEXITCODE"
    }
  }
  finally {
    Pop-Location
    if ($hadDistributionChannel) {
      $env:VITE_DISTRIBUTION_CHANNEL = $previousDistributionChannel
    }
    else {
      Remove-Item Env:\VITE_DISTRIBUTION_CHANNEL -ErrorAction SilentlyContinue
    }
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
    <DisplayName>$(Escape-Xml $PackageDisplayName)</DisplayName>
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
        DisplayName="$(Escape-Xml $PackageDisplayName)"
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

$msixUploadPath = $null
if ($StoreUpload) {
  $uploadStageDir = Join-Path $outDir "upload"
  Assert-UnderRoot $uploadStageDir $repoRootPath | Out-Null

  if (Test-Path -LiteralPath $uploadStageDir) {
    Remove-Item -LiteralPath $uploadStageDir -Recurse -Force
  }

  New-Item -ItemType Directory -Force -Path $uploadStageDir | Out-Null
  Copy-Item -LiteralPath $msixPath -Destination (Join-Path $uploadStageDir (Split-Path -Leaf $msixPath)) -Force

  $releasePdb = Join-Path $repoRootPath "src-tauri\target\release\app.pdb"
  if (Test-Path -LiteralPath $releasePdb) {
    $appxSymPath = Join-Path $uploadStageDir "$productName.appxsym"
    $appxSymZipPath = Join-Path $uploadStageDir "$productName-symbols.zip"
    Compress-Archive -LiteralPath $releasePdb -DestinationPath $appxSymZipPath -CompressionLevel Optimal -Force
    Move-Item -LiteralPath $appxSymZipPath -Destination $appxSymPath -Force
  }
  else {
    Write-Warning "Release symbols not found at $releasePdb. The upload will not include crash-analysis symbols."
  }

  $msixUploadPath = Join-Path $outDir "$($productName)_$($msixVersion)_x64.msixupload"
  if (Test-Path -LiteralPath $msixUploadPath) {
    Remove-Item -LiteralPath $msixUploadPath -Force
  }

  $msixUploadZipPath = Join-Path $outDir "$($productName)_$($msixVersion)_x64.zip"
  if (Test-Path -LiteralPath $msixUploadZipPath) {
    Remove-Item -LiteralPath $msixUploadZipPath -Force
  }

  Compress-Archive -Path (Join-Path $uploadStageDir "*") -DestinationPath $msixUploadZipPath -CompressionLevel Optimal
  Move-Item -LiteralPath $msixUploadZipPath -Destination $msixUploadPath -Force
}

Write-Host ""
Write-Host "MSIX package:"
Write-Host "  $msixPath"
Write-Host ""
Write-Host "Signature status:"
Write-Host "  $($signature.Status)"
Write-Host "  $($signature.StatusMessage)"

if ($msixUploadPath) {
  Write-Host ""
  Write-Host "Microsoft Store upload package:"
  Write-Host "  $msixUploadPath"
}

if ($Unsigned -and $StoreUpload) {
  Write-Host ""
  Write-Host "Unsigned Store package created. Microsoft signs the package after Store certification."
}
elseif ($Unsigned) {
  Write-Host ""
  Write-Host "Unsigned package created. For Microsoft Store submission, replace PackageIdentityName and Publisher with the exact Partner Center values."
}
