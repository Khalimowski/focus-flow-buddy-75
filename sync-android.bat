@echo off
setlocal

echo [1/6] Building web project...
call bun run build
if errorlevel 1 goto :fail

echo [2/6] Verifying build output...
if not exist dist\client\_shell.html (
    echo ERROR: dist\client\_shell.html missing - the build did not produce fresh output.
    goto :fail
)

echo [3/6] Preparing index.html...
copy /y dist\client\_shell.html dist\client\index.html >nul
if errorlevel 1 goto :fail

echo [4/6] Cleaning old Android assets...
if exist android\app\src\main\assets\public rmdir /s /q android\app\src\main\assets\public
mkdir android\app\src\main\assets\public

echo [5/6] Copying new assets...
xcopy /e /y /q dist\client\* android\app\src\main\assets\public\
if errorlevel 1 goto :fail

echo [6/6] Syncing Capacitor...
if exist node_modules\.bin\cap.cmd (
    call node_modules\.bin\cap sync android
) else (
    call npx cap sync android
)
if errorlevel 1 goto :fail

echo.
echo SUCCESS! Assets synced.
echo Verify on-device: the Settings footer shows this bundle's build date.
echo Please REBUILD and RUN the app in Android Studio now.
exit /b 0

:fail
echo.
echo *** SYNC FAILED - Android assets were NOT updated with a fresh build. ***
echo *** The APK would contain OLD app code. Fix the error above and re-run. ***
exit /b 1
