#!/bin/bash

# Deployment script for AccuRadio Parser
# Usage: ./deploy.sh
# Password will be prompted (handles special characters safely)

set -e

# Configuration
SERVER="10.10.10.231"
USER="root"
REMOTE_DIR="/opt/accuradio"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}🚀 Deploying AccuRadio Parser to ${SERVER}${NC}"

# Check if sshpass is available
if ! command -v sshpass &> /dev/null; then
    echo -e "${RED}Error: sshpass is not installed${NC}"
    echo "Install with: sudo apt install sshpass"
    exit 1
fi

# Prompt for password (handles special characters)
read -sp "Enter SSH password for ${USER}@${SERVER}: " SSH_PASS
echo
export SSHPASS="$SSH_PASS"

# SSH and SCP commands using SSHPASS env variable
SSH_CMD="sshpass -e ssh -o StrictHostKeyChecking=no ${USER}@${SERVER}"
SCP_CMD="sshpass -e scp -o StrictHostKeyChecking=no"

echo -e "${YELLOW}📁 Creating remote directory...${NC}"
$SSH_CMD "mkdir -p ${REMOTE_DIR}/src"

echo -e "${YELLOW}📦 Copying files to server...${NC}"

# Copy main files
$SCP_CMD Dockerfile "${USER}@${SERVER}:${REMOTE_DIR}/"
$SCP_CMD docker-compose.yml "${USER}@${SERVER}:${REMOTE_DIR}/"
$SCP_CMD package.json "${USER}@${SERVER}:${REMOTE_DIR}/"
$SCP_CMD package-lock.json "${USER}@${SERVER}:${REMOTE_DIR}/" 2>/dev/null || true

# Copy src directory
$SCP_CMD -r src/* "${USER}@${SERVER}:${REMOTE_DIR}/src/"

echo -e "${YELLOW}🐳 Building and starting containers...${NC}"
$SSH_CMD "cd ${REMOTE_DIR} && docker compose down 2>/dev/null || true"
$SSH_CMD "cd ${REMOTE_DIR} && docker compose build --no-cache"
$SSH_CMD "cd ${REMOTE_DIR} && docker compose up -d"

echo -e "${YELLOW}📋 Checking container status...${NC}"
$SSH_CMD "cd ${REMOTE_DIR} && docker compose ps"

# Clear password from environment
unset SSHPASS

echo -e "${GREEN}✅ Deployment complete!${NC}"
echo -e "${GREEN}🌐 App available at: http://${SERVER}:3000${NC}"
echo -e "${GREEN}🔧 Admin mode: http://${SERVER}:3000/?showAdmin=true${NC}"
