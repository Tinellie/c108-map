import "dotenv/config";

const requiredKeys = ["MYSQL_HOST", "MYSQL_USER", "MYSQL_DATABASE"];

for (const key of requiredKeys) {
  if (!process.env[key]) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
}

export const config = {
  db: {
    host: process.env.MYSQL_HOST,
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD || "",
    database: process.env.MYSQL_DATABASE,
    connectionLimit: Number(process.env.MYSQL_CONNECTION_LIMIT || 10)
  },
  puppeteer: {
    headless: process.env.PUPPETEER_HEADLESS === "true",
    navigationTimeoutMs: Number(process.env.PUPPETEER_NAVIGATION_TIMEOUT_MS || 45000),
    executablePath: process.env.CHROME_EXECUTABLE_PATH || "",
    userDataDir: process.env.CHROME_USER_DATA_DIR || "",
    profileDirectory: process.env.CHROME_PROFILE_DIRECTORY || "",
    browserWSEndpoint: process.env.PUPPETEER_BROWSER_WS_ENDPOINT || ""
  },
  images: {
    downloadDir: process.env.IMAGE_DOWNLOAD_DIR || "storage/images/circle"
  },
  map: {
    pdfPath: process.env.MAP_PDF_PATH || "storage/map.pdf",
    extractionOutputDir: process.env.MAP_EXTRACTION_OUTPUT_DIR || "storage/map_extracted",
    extractionDpi: Number(process.env.MAP_EXTRACTION_DPI || 200)
  },
  api: {
    host: process.env.API_HOST || "127.0.0.1",
    port: Number(process.env.API_PORT || 3000),
    corsOrigin: process.env.API_CORS_ORIGIN || "*"
  }
};
