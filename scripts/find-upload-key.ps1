# Finds the Google Play upload keystore on this machine.
#
# Play rejected an upload because it was signed with the wrong key. This
# script scans the usual places for keystore files, prints each one's SHA1
# certificate fingerprint, and flags the one matching the upload key that
# Play expects. Run it in PowerShell:
#
#   powershell -ExecutionPolicy Bypass -File scripts\find-upload-key.ps1
#
# You'll be asked for the keystore password for each candidate (press Enter
# to skip one you don't recognize). JKS keystores usually list without a
# password; PKCS12 ones require it.

$ExpectedSha1 = "45:1E:5D:A4:0B:4B:C3:F6:CB:79:DE:E3:C4:BD:ED:7E:A6:17:5E:4E"
$RejectedSha1 = "94:1B:DF:72:49:78:49:4E:C7:7C:F7:42:2D:B4:BA:BC:52:42:8B:4A"

# keytool ships with Android Studio's bundled JDK; fall back to any on PATH.
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
Write-Host "Using keytool: $keytool`n"

function Get-KeystoreSha1($path, $password) {
    $passwordArgs = @()
    if ($password) { $passwordArgs = @("-storepass", $password) }
    $output = & $keytool -list -v -keystore $path @passwordArgs 2>&1 | Out-String
    if ($output -match "SHA1:\s*([0-9A-F:]{59})") { return $Matches[1] }
    return $null
}

Write-Host "Scanning for keystore files (this can take a minute)..."
$searchRoots = @(
    $env:USERPROFILE,
    "C:\Android",
    "D:\"
) | Where-Object { Test-Path $_ }

$candidates = $searchRoots | ForEach-Object {
    Get-ChildItem $_ -Recurse -File -Include *.jks, *.keystore -ErrorAction SilentlyContinue
} | Sort-Object FullName -Unique

if (-not $candidates) {
    Write-Host "`nNo .jks or .keystore files found." -ForegroundColor Yellow
    Write-Host "If you know the keystore is on another drive, edit `$searchRoots in this script."
    Write-Host "If the upload keystore is truly lost, request an upload key reset in Play"
    Write-Host "Console: Test and release -> Setup -> App signing."
    exit 0
}

Write-Host "Found $($candidates.Count) candidate(s).`n"
$foundMatch = $false

foreach ($file in $candidates) {
    Write-Host "--- $($file.FullName)" -ForegroundColor Cyan

    # The debug keystore always uses the well-known password "android".
    $isDebug = $file.Name -eq "debug.keystore"
    $sha1 = if ($isDebug) { Get-KeystoreSha1 $file.FullName "android" } else { Get-KeystoreSha1 $file.FullName $null }

    if (-not $sha1 -and -not $isDebug) {
        $pw = Read-Host "    Needs a password. Enter it (or press Enter to skip)"
        if ($pw) { $sha1 = Get-KeystoreSha1 $file.FullName $pw }
    }

    if (-not $sha1) {
        Write-Host "    Could not read (wrong/no password). Skipped." -ForegroundColor DarkGray
        continue
    }

    Write-Host "    SHA1: $sha1"
    if ($sha1 -eq $ExpectedSha1) {
        Write-Host "    >>> THIS IS THE CORRECT UPLOAD KEY <<<" -ForegroundColor Green
        $foundMatch = $true
    } elseif ($sha1 -eq $RejectedSha1) {
        Write-Host "    This is the key Play just REJECTED - don't use it." -ForegroundColor Yellow
    }
}

Write-Host ""
if ($foundMatch) {
    Write-Host "Next step: Build -> Generate Signed App Bundle in Android Studio and pick" -ForegroundColor Green
    Write-Host "the keystore marked above, then re-upload the .aab to Play Console." -ForegroundColor Green
} else {
    Write-Host "No keystore matched the expected upload key ($ExpectedSha1)." -ForegroundColor Yellow
    Write-Host "Re-run and enter passwords for any skipped files, or search other drives."
    Write-Host "If it's truly lost, request an upload key reset in Play Console:"
    Write-Host "Test and release -> Setup -> App signing -> Request upload key reset."
}
