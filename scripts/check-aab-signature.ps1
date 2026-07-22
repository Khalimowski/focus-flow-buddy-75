# Checks which key an .aab is signed with BEFORE you upload it to Play.
#
#   powershell -ExecutionPolicy Bypass -File scripts\check-aab-signature.ps1 [path\to\app.aab]
#
# Without an argument it checks the default Android Studio output:
#   android\app\build\outputs\bundle\release\app-release.aab
# Prints PASS if Play will accept the signature, FAIL otherwise.

$ExpectedSha1 = "45:1E:5D:A4:0B:4B:C3:F6:CB:79:DE:E3:C4:BD:ED:7E:A6:17:5E:4E"

$aab = $args[0]
if (-not $aab) {
    $aab = Join-Path $PSScriptRoot "..\android\app\build\outputs\bundle\release\app-release.aab"
}
if (-not (Test-Path $aab)) {
    Write-Host "No .aab found at: $aab" -ForegroundColor Red
    Write-Host "Build one first (Build -> Generate Signed App Bundle) or pass the path as an argument."
    exit 1
}
$file = Get-Item $aab
Write-Host "Checking: $($file.FullName)"
Write-Host "Built at: $($file.LastWriteTime)  (make sure this is the build you just made!)`n"

$keytoolCandidates = @(
    "$env:ProgramFiles\Android\Android Studio\jbr\bin\keytool.exe",
    "${env:ProgramFiles(x86)}\Android\Android Studio\jbr\bin\keytool.exe",
    "$env:JAVA_HOME\bin\keytool.exe",
    "keytool"
)
$keytool = $keytoolCandidates | Where-Object { Get-Command $_ -ErrorAction SilentlyContinue } | Select-Object -First 1
if (-not $keytool) {
    Write-Host "keytool not found. Install Android Studio or a JDK first." -ForegroundColor Red
    exit 1
}

$output = & $keytool -printcert -jarfile $file.FullName 2>&1 | Out-String
if ($output -notmatch "SHA1:\s*([0-9A-F:]{59})") {
    Write-Host "Could not read a signature from this file - it may be unsigned." -ForegroundColor Red
    Write-Host $output
    exit 1
}
$sha1 = $Matches[1]

Write-Host "Signed with SHA1: $sha1"
Write-Host "Play expects:     $ExpectedSha1`n"
if ($sha1 -eq $ExpectedSha1) {
    Write-Host "PASS - Play will accept this bundle. Upload it." -ForegroundColor Green
} else {
    Write-Host "FAIL - Play will REJECT this bundle (wrong key)." -ForegroundColor Red
    Write-Host "Rebuild with the keystore flagged by scripts\find-upload-key.ps1,"
    Write-Host "or if that script found no match, request an upload key reset in"
    Write-Host "Play Console: Test and release -> Setup -> App signing."
}
