# Dockerfile: rollback to the working stack (Apify v3 + Playwright Chromium)
FROM apify/actor-node-playwright-chrome:20

# Install deps as root to avoid EACCES, then drop privileges.
USER root
WORKDIR /usr/src/app

# Install only production deps
COPY package*.json ./
RUN npm install --omit=dev --omit=optional --no-audit --no-fund

# Copy source
COPY . .

# Make app files owned by non-root runtime user
RUN chown -R myuser:myuser /usr/src/app

# Drop to non-root for runtime
USER myuser

# Apify will wrap this with xvfb-run automatically
CMD ["node", "main.js"]
