@echo off
REM Deployment script for AccuRadio Parser (Windows)
REM Usage: deploy.bat [password]

setlocal enabledelayedexpansion

REM Configuration
set SERVER=10.10.10.231
set USER=root
set REMOTE_DIR=/opt/accuradio
set SSH_PASS=%1

echo 🚀 Deploying AccuRadio Parser to %SERVER%

REM Check if password is provided
if "%SSH_PASS%"=="" (
    set /p SSH_PASS="Enter SSH password for %USER%@%SERVER%: "
)

echo 📁 Creating remote directory...
sshpass -p "%SSH_PASS%" ssh -o StrictHostKeyChecking=no %USER%@%SERVER% "mkdir -p %REMOTE_DIR%/src"

echo 📦 Copying files to server...
sshpass -p "%SSH_PASS%" scp -o StrictHostKeyChecking=no Dockerfile %USER%@%SERVER%:%REMOTE_DIR%/
sshpass -p "%SSH_PASS%" scp -o StrictHostKeyChecking=no docker-compose.yml %USER%@%SERVER%:%REMOTE_DIR%/
sshpass -p "%SSH_PASS%" scp -o StrictHostKeyChecking=no package.json %USER%@%SERVER%:%REMOTE_DIR%/
sshpass -p "%SSH_PASS%" scp -o StrictHostKeyChecking=no -r src/* %USER%@%SERVER%:%REMOTE_DIR%/src/

echo 🐳 Building and starting containers...
sshpass -p "%SSH_PASS%" ssh -o StrictHostKeyChecking=no %USER%@%SERVER% "cd %REMOTE_DIR% && docker-compose down 2>/dev/null || true"
sshpass -p "%SSH_PASS%" ssh -o StrictHostKeyChecking=no %USER%@%SERVER% "cd %REMOTE_DIR% && docker-compose build --no-cache"
sshpass -p "%SSH_PASS%" ssh -o StrictHostKeyChecking=no %USER%@%SERVER% "cd %REMOTE_DIR% && docker-compose up -d"

echo 📋 Checking container status...
sshpass -p "%SSH_PASS%" ssh -o StrictHostKeyChecking=no %USER%@%SERVER% "cd %REMOTE_DIR% && docker-compose ps"

echo.
echo ✅ Deployment complete!
echo 🌐 App available at: http://%SERVER%:3000
echo 🔧 Admin mode: http://%SERVER%:3000/?showAdmin=true

endlocal
