# Use Node.js for serving static files
FROM node:18-alpine

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy static files
COPY . .

# Expose port
EXPOSE 3000

# Start the server
CMD ["npm", "start"]