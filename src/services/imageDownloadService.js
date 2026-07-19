import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { logInfo, logStep } from "../utils/logger.js";

function sanitizeFileName(value) {
  return String(value || "image")
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
    .trim() || "image";
}

function buildCookieHeader(cookies = []) {
  return cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
}

async function downloadFileIfMissing({ fileUrl, targetPath, cookies, referer }) {
  try {
    await stat(targetPath);
    return false;
  } catch {
    // continue to download
  }

  const response = await fetch(fileUrl, {
    headers: {
      ...(cookies.length > 0 ? { Cookie: buildCookieHeader(cookies) } : {}),
      ...(referer ? { Referer: referer } : {}),
      "User-Agent": "Mozilla/5.0"
    }
  });

  if (!response.ok) {
    throw new Error(`Failed to download ${fileUrl}: ${response.status} ${response.statusText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  await mkdir(path.dirname(targetPath), { recursive: true });
  await writeFile(targetPath, Buffer.from(arrayBuffer));
  return true;
}

export async function downloadCircleImages(circles, { pageUrl, cookies, downloadDir }) {
  if (!circles.length) {
    return { downloaded: 0, skipped: 0 };
  }

  logStep("Downloading circle images", `circles=${circles.length}`);

  let downloaded = 0;
  let skipped = 0;

  for (const circle of circles) {
    const imageUrls = Array.from(new Set(circle.source_images || []));
    const localImagePaths = [];

    for (const imageUrl of imageUrls) {
      const resolvedUrl = new URL(imageUrl, pageUrl).href;
      const parsed = new URL(resolvedUrl);
      const baseName = path.posix.basename(parsed.pathname, path.posix.extname(parsed.pathname)) || "image";
      const fileName = `${sanitizeFileName(baseName)}.png`;
      const targetRelativePath = path.posix.join(downloadDir, String(circle.circle_id), fileName);
      const targetAbsolutePath = path.resolve(targetRelativePath);

      const wasDownloaded = await downloadFileIfMissing({
        fileUrl: resolvedUrl,
        targetPath: targetAbsolutePath,
        cookies,
        referer: pageUrl
      });

      if (wasDownloaded) {
        downloaded += 1;
      } else {
        skipped += 1;
      }

      localImagePaths.push(targetRelativePath.replace(/\\/g, "/"));
    }

    circle.local_image_paths = localImagePaths;
  }

  logInfo("Image sync complete", `downloaded=${downloaded}, skipped=${skipped}`);
  return { downloaded, skipped };
}
