import { testConnection, pool } from "./db/pool.js";
import { getProfileByName, profiles } from "./profiles/index.js";
import { runCrawlPipeline } from "./services/crawlPipeline.js";
import { logError, logInfo, logStep, logSuccess } from "./utils/logger.js";

function parseCliArgs(argv) {
  const args = {};

  for (const part of argv) {
    if (!part.startsWith("--")) {
      continue;
    }

    const normalized = part.replace(/^--/, "");
    const separatorIndex = normalized.indexOf("=");
    const key = separatorIndex === -1 ? normalized : normalized.slice(0, separatorIndex);
    const value = separatorIndex === -1 ? undefined : normalized.slice(separatorIndex + 1);
    args[key] = value === undefined ? true : value;
  }

  return args;
}

function parseHeadlessFlag(value) {
  if (value === undefined) {
    return undefined;
  }

  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  throw new Error("Invalid --headless value. Use true or false.");
}

async function main() {
  logStep("Starting crawler process");
  const args = parseCliArgs(process.argv.slice(2));
  const url = args.url;

  if (!url) {
    throw new Error("Missing --url argument. Example: npm start -- --url=https://example.com");
  }

  const profileName = args.profile || "default";
  const selectedProfile = getProfileByName(profileName);

  if (!selectedProfile) {
    throw new Error(`Unknown profile: ${profileName}. Available: ${Object.keys(profiles).join(", ")}`);
  }

  logInfo("Runtime args parsed", `profile=${profileName}, headless=${String(args.headless ?? "env")}`);
  logInfo("Target URL", url);

  logStep("Testing MySQL connection");
  await testConnection();
  logSuccess("MySQL connection OK");

  logStep("Running crawl pipeline");
  const summary = await runCrawlPipeline({
    url,
    profile: selectedProfile,
    headlessOverride: parseHeadlessFlag(args.headless)
  });

  logSuccess("Crawl finished");
  console.log(JSON.stringify(summary, null, 2));
}

main()
  .catch(async (error) => {
    logError("Crawler failed", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    logStep("Closing DB pool");
    await pool.end();
    logSuccess("DB pool closed");
  });
