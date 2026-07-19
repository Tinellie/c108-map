import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { formatDurationMs, logSubStep, logSuccess } from "../utils/logger.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..", "..");
const defaultPdfPath = path.join(projectRoot, "storage", "map.pdf");
const defaultOutputDir = path.join(projectRoot, "storage", "map_extracted");
const defaultSummaryPath = path.join(defaultOutputDir, "summary.json");
const defaultExtractionConfig = Object.freeze({
  pdfPath: defaultPdfPath,
  outputDir: defaultOutputDir,
  summaryPath: defaultSummaryPath,
  dpi: 200
});

function resolveMapExtractionConfig({ pdfPath, outputDir, summaryPath, dpi } = {}) {
  const resolvedOutputDir = outputDir || defaultOutputDir;
  return {
    pdfPath: pdfPath || defaultPdfPath,
    outputDir: resolvedOutputDir,
    summaryPath: summaryPath || path.join(resolvedOutputDir, "summary.json"),
    dpi: Number(dpi || defaultExtractionConfig.dpi)
  };
}

function runPythonScript(args) {
  return new Promise((resolve, reject) => {
    const startedAt = process.hrtime.bigint();
    logSubStep("Spawn Python extractor", args.join(" "));

    const child = spawn("python", args, {
      cwd: projectRoot,
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });

    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr || stdout || `python process failed with code ${code}`));
        return;
      }
      logSuccess("Map extractor process finished", `code=${code} | ${formatDurationMs(startedAt)}`);
      resolve({ stdout, stderr });
    });
  });
}

export async function runMapExtraction(options = {}) {
  const { pdfPath, outputDir, summaryPath, dpi } = resolveMapExtractionConfig(options);
  const startedAt = process.hrtime.bigint();
  logSubStep("Resolve extraction inputs", `pdf=${pdfPath} | output=${outputDir} | dpi=${dpi}`);

  await runPythonScript([
    path.join("src", "tools", "extract_map_booths.py"),
    "--pdf",
    pdfPath,
    "--output",
    outputDir,
    "--dpi",
    String(dpi)
  ]);

  logSubStep("Read regenerated summary", summaryPath);
  const summary = await readLatestMapExtractionSummary({ summaryPath });
  logSuccess(
    "Map extraction completed",
    `pages=${summary.pageCount} | booths=${summary.totalBooths} | ${formatDurationMs(startedAt)}`
  );
  return summary;
}

export async function readLatestMapExtractionSummary({ summaryPath = defaultSummaryPath } = {}) {
  const startedAt = process.hrtime.bigint();
  logSubStep("Read extraction summary JSON", summaryPath);
  const raw = await fs.readFile(summaryPath, "utf-8");
  const parsed = JSON.parse(raw);
  logSuccess(
    "Map summary loaded",
    `pages=${parsed.pageCount || 0} | booths=${parsed.totalBooths || 0} | ${formatDurationMs(startedAt)}`
  );
  return parsed;
}

export async function mapExtractionSummaryExists({ summaryPath = defaultSummaryPath } = {}) {
  try {
    await fs.access(summaryPath);
    return true;
  } catch {
    return false;
  }
}

export async function readMapExtractionSummaryIfExists(options = {}) {
  const { summaryPath } = resolveMapExtractionConfig(options);
  const exists = await mapExtractionSummaryExists({ summaryPath });
  if (!exists) {
    return null;
  }

  return readLatestMapExtractionSummary({ summaryPath });
}

export function getDefaultMapExtractionConfig() {
  return { ...defaultExtractionConfig };
}
