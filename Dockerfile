FROM apify/actor-node-playwright-chrome:20

WORKDIR /usr/src/app

# Install dependencies as root to avoid EACCES
USER root
COPY package*.json ./
RUN npm install --omit=dev --omit=optional --no-audit --no-fund

# Copy the rest of the project
COPY . .

# Ensure myuser owns the working dir
RUN chown -R myuser:myuser /usr/src/app

USER myuser
CMD ["node", "main.js"]
