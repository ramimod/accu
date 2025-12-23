FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install --production

# Copy source code
COPY src/ ./src/

# Create imgs directory for downloaded images
RUN mkdir -p src/imgs

# Expose port
EXPOSE 3000

# Start the server
CMD ["node", "src/server.js"]
