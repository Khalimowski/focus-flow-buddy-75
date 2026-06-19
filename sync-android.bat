@echo off
echo [1/5] Building web project...
call bun run build

echo [2/5] Cleaning old Android assets...
if exist android\app\src\main\assets\public rmdir /s /q android\app\src\main\assets\public
mkdir android\app\src\main\assets\public

echo [3/5] Preparing index.html...
if exist dist\client\_shell.html copy /y dist\client\_shell.html dist\client\index.html

echo [4/5] Copying new assets...
xcopy /e /y /q dist\client\* android\app\src\main\assets\public\

echo [5/5] Syncing Capacitor...
if exist node_modules\.bin\cap (
    call node_modules\.bin\cap sync android
) else (
    call npx cap sync android
)

echo.
echo SUCCESS! Assets synced.
echo Please REBUILD and RUN the app in Android Studio now.
