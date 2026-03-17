# Use Node.js for serving static files
FROM node:18-alpine

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies (npm ci requires a lockfile; use install so build works without package-lock.json)
RUN npm install --omit=dev

# Copy static files
COPY . .

# Expose port
EXPOSE 3000

# Start the server
CMD ["npm", "start"]