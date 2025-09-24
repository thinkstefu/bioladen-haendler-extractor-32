FROM apify/actor-node-playwright-chrome:20

# Workdir
WORKDIR /usr/src/app

# Copy all files (no npm install needed; base image already has apify + playwright)
COPY . ./

# Default command
CMD ["node","main.js"]
