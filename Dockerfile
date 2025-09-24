FROM apify/actor-node-playwright-chrome:20

WORKDIR /usr/src/app
COPY . ./

# Default command
CMD ["node", "main.js"]
