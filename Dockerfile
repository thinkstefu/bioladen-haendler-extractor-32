# Minimal Dockerfile to ensure dependencies are installed and readable at runtime.
FROM apify/actor-node-playwright-chrome:20

# Work as root for installs to avoid EACCES
USER root
WORKDIR /usr/src/app

# Install only production deps; no browsers are downloaded (they are in the base image)
COPY package*.json ./
RUN npm install --omit=dev --omit=optional --no-audit --no-fund

# Copy the rest of the project
COPY . .

# Make sure runtime user can read the app directory
RUN chown -R myuser:myuser /usr/src/app

# Drop privileges for runtime
USER myuser

# Start your actor
CMD ["node", "main.js"]
