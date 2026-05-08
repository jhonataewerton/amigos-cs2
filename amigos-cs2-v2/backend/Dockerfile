FROM node:22-bullseye-slim

# Install deps required by Chromium
RUN apt-get update && apt-get install -y --no-install-recommends \
  ca-certificates \
  fonts-liberation \
  libatk-bridge2.0-0 \
  libatk1.0-0 \
  libc6 \
  libcairo2 \
  libdbus-1-3 \
  libdrm2 \
  libgdk-pixbuf2.0-0 \
  libgbm1 \
  libgtk-3-0 \
  libnspr4 \
  libnss3 \
  libx11-xcb1 \
  libxcomposite1 \
  libxdamage1 \
  libxrandr2 \
  libxss1 \
  libxtst6 \
  lsb-release \
  wget \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace

COPY package*.json ./
RUN npm ci --only=production

COPY . .

ENV PORT=8080
EXPOSE 8080
CMD ["node", "src/index.js"]
