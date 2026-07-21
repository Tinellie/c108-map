FROM node:22-bookworm-slim

ENV NODE_ENV=production
ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV CHROME_EXECUTABLE_PATH=/usr/bin/chromium

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    chromium \
    fonts-noto-cjk \
    poppler-utils \
    python3 \
    python3-pip \
    tini \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY requirements-map.txt ./
RUN pip3 install --no-cache-dir -r requirements-map.txt

COPY src ./src

RUN mkdir -p /app/storage/images /app/storage/map /app/storage/map_extracted /app/storage/osm

EXPOSE 3000

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "src/api/server.js"]
