# Minimal, stable build that avoids EACCES and ships Playwright Chrome
FROM apify/actor-node-playwright-chrome:20

# Workdir
WORKDIR /usr/src/app

# Copy package manifests with correct ownership so npm can write node_modules
COPY --chown=myuser:myuser package*.json ./

# Use non-root user provided by the base image
USER myuser

# Install only production deps
RUN npm install --omit=dev --no-optional --no-audit --no-fund

# Copy the rest of the source
COPY --chown=myuser:myuser . .

# Default command
CMD ["node", "main.js"]
