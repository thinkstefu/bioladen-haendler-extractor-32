FROM apify/actor-node-playwright-chrome:20

# Workdir
WORKDIR /usr/src/app

# Copy all sources (no npm install required; base image contains Apify SDK + Playwright)
COPY . .

# Default command
CMD ["node", "main.js"]
