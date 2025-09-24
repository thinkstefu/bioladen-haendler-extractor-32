FROM apify/actor-node-playwright-chrome:20

# Work directory
WORKDIR /usr/src/app

# Copy sources
COPY . .

# Run as non-root user provided by the base image
USER myuser

# Start
CMD ["node", "main.js"]
