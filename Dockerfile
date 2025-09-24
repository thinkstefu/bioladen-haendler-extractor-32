# Simple, stable build that avoids EACCES during npm install
FROM apify/actor-node-playwright-chrome:20

# Work as root for install steps to avoid permission problems
USER root
WORKDIR /usr/src/app

# Install deps as root, then copy sources and chown to myuser
COPY package*.json ./
RUN npm install --omit=dev --omit=optional --no-audit --no-fund

COPY . .
RUN chown -R myuser:myuser /usr/src/app

# Drop privileges for runtime
USER myuser
CMD ["node", "main.js"]
