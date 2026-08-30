@echo off
setlocal DisableDelayedExpansion
set "BOOTSTRAP=%~dp0tools\bootstrap_windows.ps1"
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "%BOOTSTRAP%" %*
set "DEMO_EXIT=%ERRORLEVEL%"
if not "%DEMO_EXIT%"=="0" if "%~1"=="" pause
endlocal & exit /b %DEMO_EXIT%
