@echo off
setlocal DisableDelayedExpansion

pushd "%~dp0" >nul 2>&1
if errorlevel 1 goto :pushd_failed

set "ORIGINAL_CODE_PAGE="
set "CODE_PAGE_CHANGED="
for /f "delims=" %%C in ('chcp') do for %%P in (%%C) do set "ORIGINAL_CODE_PAGE=%%P"
chcp 65001 >nul 2>&1
if not errorlevel 1 set "CODE_PAGE_CHANGED=1"

if not exist "..\.venv\Scripts\python.exe" goto :probe_py
"..\.venv\Scripts\python.exe" -c "import sys; raise SystemExit(sys.version_info < (3, 11))" >nul 2>&1
if errorlevel 1 goto :probe_py
"..\.venv\Scripts\python.exe" "tools\serve_demo.py" %*
set "DEMO_EXIT=%ERRORLEVEL%"
goto :finish

:probe_py
call py -3 -c "import sys; raise SystemExit(sys.version_info < (3, 11))" >nul 2>&1
if errorlevel 1 goto :probe_python
call py -3 "tools\serve_demo.py" %*
set "DEMO_EXIT=%ERRORLEVEL%"
goto :finish

:probe_python
call python -c "import sys; raise SystemExit(sys.version_info < (3, 11))" >nul 2>&1
if errorlevel 1 goto :missing_python
call python "tools\serve_demo.py" %*
set "DEMO_EXIT=%ERRORLEVEL%"
goto :finish

:missing_python
echo ERROR: Python 3.11+ is required to launch the LingShu WebDemo.
echo Install Python 3.11 or newer, then try start-demo.bat again.
echo Manual command from the repository root:
echo   python web_demo\tools\serve_demo.py
set "DEMO_EXIT=1"

:scan_missing_arguments
if "%~1"=="" goto :maybe_pause
if /i "%~1"=="--check" goto :finish
shift
goto :scan_missing_arguments

:maybe_pause
set CMDCMDLINE | "%SystemRoot%\System32\findstr.exe" /i /c:" /c " >nul 2>&1
if errorlevel 1 goto :finish
pause
goto :finish

:pushd_failed
echo ERROR: Could not open the WebDemo directory: "%~dp0"
endlocal & exit /b 1

:finish
if defined CODE_PAGE_CHANGED if defined ORIGINAL_CODE_PAGE chcp %ORIGINAL_CODE_PAGE% >nul 2>&1
popd
endlocal & exit /b %DEMO_EXIT%
