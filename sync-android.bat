@echo off
setlocal

echo [1/9] Building web project...
call bun run build
if errorlevel 1 goto :fail

echo [2/9] Verifying build output...
if not exist dist\client\_shell.html (
    echo ERROR: dist\client\_shell.html missing - the build did not produce fresh output.
    goto :fail
)

echo [3/9] Verifying brand assets in the build...
if not exist dist\client\logo-lockup.png (
    echo ERROR: dist\client\logo-lockup.png is missing from the build.
    echo        This file exists only from the bust-and-checklist rebrand onward,
    echo        so the working tree is almost certainly behind. Run: git pull
    goto :fail
)

echo [4/9] Verifying native icons in the checkout...
if not exist android\app\src\main\res\mipmap-xxxhdpi\ic_launcher_monochrome.png (
    echo ERROR: mipmap-xxxhdpi\ic_launcher_monochrome.png is missing.
    echo        Launcher icons live under android\app\src\main\res and are never
    echo        touched by this script or by cap sync - they come straight from git.
    echo        This one exists only from the rebrand onward. Run: git pull
    goto :fail
)
if exist android\app\src\main\res\drawable\ic_launcher_foreground.xml (
    echo ERROR: drawable\ic_launcher_foreground.xml still exists.
    echo        That is the OLD orbit-mark vector, deleted by the rebrand. If it is
    echo        still here the checkout is behind and the APK will build the old
    echo        launcher icon no matter how clean the web bundle is. Run: git pull
    goto :fail
)

echo [5/9] Preparing index.html...
copy /y dist\client\_shell.html dist\client\index.html >nul
if errorlevel 1 goto :fail

echo [6/9] Cleaning old Android assets...
if exist android\app\src\main\assets\public rmdir /s /q android\app\src\main\assets\public
mkdir android\app\src\main\assets\public

echo [7/9] Copying new assets...
xcopy /e /y /q dist\client\* android\app\src\main\assets\public\
if errorlevel 1 goto :fail

echo [8/9] Verifying copied assets...
if not exist android\app\src\main\assets\public\logo-lockup.png (
    echo ERROR: logo-lockup.png did not reach android\app\src\main\assets\public.
    echo        The copy step did not deliver the fresh bundle.
    goto :fail
)

echo [9/9] Syncing Capacitor...
if exist node_modules\.bin\cap.cmd (
    call node_modules\.bin\cap sync android
) else (
    call npx cap sync android
)
if errorlevel 1 goto :fail

echo.
echo SUCCESS! Assets synced.
echo Verify on-device: the Settings footer shows this bundle's build date.
echo.
echo If the LAUNCHER ICON still looks old after this, it is not the bundle -
echo uninstall the app first, then install. Android launchers cache the icon
echo per package and keep the old one when you install over the top.
echo Build - Clean Project in Android Studio clears stale compiled resources.
echo.
echo Please REBUILD and RUN the app in Android Studio now.
exit /b 0

:fail
echo.
echo *** SYNC FAILED - Android assets were NOT updated with a fresh build. ***
echo *** The APK would contain OLD app code. Fix the error above and re-run. ***
exit /b 1
