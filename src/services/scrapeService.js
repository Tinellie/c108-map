import puppeteer from "puppeteer";
import { config } from "../config/env.js";
import { logInfo, logStep, logWarn } from "../utils/logger.js";

function trimText(value) {
  return (value || "").replace(/\s+/g, " ").trim();
}

async function getLoginPageState(page, loginWait, title) {
  const looksLikeLoginTitle =
    typeof loginWait?.loginTitleKeyword === "string" &&
    loginWait.loginTitleKeyword.length > 0 &&
    title.includes(loginWait.loginTitleKeyword);

  const hasLoginForm = loginWait?.loginFormSelector
    ? await page.$(loginWait.loginFormSelector).then(Boolean)
    : false;

  return {
    looksLikeLoginPage: Boolean(looksLikeLoginTitle || hasLoginForm),
    hasLoginForm
  };
}

async function waitForLoginOutcome(page, loginWait) {
  const outcomeHandle = await page.waitForFunction(
    ({ successSelector, invalidCredentialSelector, invalidCredentialText }) => {
      if (successSelector && document.querySelector(successSelector)) {
        return "success";
      }

      if (invalidCredentialSelector) {
        const errorNode = document.querySelector(invalidCredentialSelector);
        const errorText = (errorNode?.textContent || "").replace(/\s+/g, " ").trim();
        if (errorText && (!invalidCredentialText || errorText.includes(invalidCredentialText))) {
          return "invalid-credentials";
        }
      }

      return false;
    },
    {
      timeout: Number(loginWait?.timeoutMs || 300000)
    },
    {
      successSelector: loginWait?.successSelector || "",
      invalidCredentialSelector: loginWait?.invalidCredentialSelector || "",
      invalidCredentialText: loginWait?.invalidCredentialText || ""
    }
  );

  const outcome = await outcomeHandle.jsonValue();
  await outcomeHandle.dispose();
  return outcome;
}

async function submitLoginForm(page, loginWait, loginCredentials) {
  await page.waitForSelector(loginWait.usernameSelector, { timeout: 10000 });
  await page.waitForSelector(loginWait.passwordSelector, { timeout: 10000 });

  await page.locator(loginWait.usernameSelector).fill(String(loginCredentials.username || ""));
  await page.locator(loginWait.passwordSelector).fill(String(loginCredentials.password || ""));

  await Promise.allSettled([
    page.waitForNavigation({ waitUntil: "networkidle2", timeout: 15000 }),
    page.click(loginWait.submitSelector)
  ]);

  const outcome = await waitForLoginOutcome(page, loginWait);
  if (outcome === "invalid-credentials") {
    const error = new Error("Circle.ms 登录失败：邮箱或密码错误");
    error.code = "INVALID_CIRCLE_MS_CREDENTIALS";
    throw error;
  }
}

export async function ensureLoggedInIfNeeded(page, profile, { loginCredentials } = {}) {
  const loginWait = profile.loginWait;
  if (!loginWait?.enabled) {
    return;
  }

  const title = await page.title();
  const { looksLikeLoginPage } = await getLoginPageState(page, loginWait, title);

  if (!looksLikeLoginPage) {
    return;
  }

  const hasCredentials = Boolean(loginCredentials?.username && loginCredentials?.password);
  if (hasCredentials) {
    logInfo("Login page detected", "Submitting Circle.ms credentials automatically...");
    await submitLoginForm(page, loginWait, loginCredentials);
    logInfo("Circle.ms login detected", "Auto login completed; continuing crawl.");
    return;
  }

  await waitForManualLoginIfNeeded(page, profile);
}

async function waitForManualLoginIfNeeded(page, profile) {
  const loginWait = profile.loginWait;
  if (!loginWait?.enabled) {
    return;
  }

  logInfo("Login page detected", "Waiting for manual login in opened browser window...");

  const outcome = await waitForLoginOutcome(page, loginWait);
  if (outcome === "invalid-credentials") {
    const error = new Error("Circle.ms 登录失败：邮箱或密码错误");
    error.code = "INVALID_CIRCLE_MS_CREDENTIALS";
    throw error;
  }

  logInfo("Manual login detected", "Target table became available; continuing crawl.");
}

export async function createScrapeSession({ headlessOverride } = {}) {
  const headless =
    typeof headlessOverride === "boolean" ? headlessOverride : config.puppeteer.headless;

  logInfo("Browser launch mode", `headless=${headless}`);

  if (config.puppeteer.browserWSEndpoint) {
    logStep("Connecting to existing browser endpoint");
    const browser = await puppeteer.connect({
      browserWSEndpoint: config.puppeteer.browserWSEndpoint
    });

    const page = await browser.newPage();
    page.setDefaultNavigationTimeout(config.puppeteer.navigationTimeoutMs);

    return {
      browser,
      page,
      shouldDisconnectOnly: true,
      async close() {
        await page.close();
        browser.disconnect();
      }
    };
  }

  logStep("Launching local browser");
  const launchOptions = {
    headless,
    pipe: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu"
    ]
  };

  if (config.puppeteer.executablePath) {
    launchOptions.executablePath = config.puppeteer.executablePath;
  }

  if (config.puppeteer.userDataDir) {
    launchOptions.userDataDir = config.puppeteer.userDataDir;
  }

  if (config.puppeteer.profileDirectory) {
    launchOptions.args.push(`--profile-directory=${config.puppeteer.profileDirectory}`);
  }

  const browser = await puppeteer.launch(launchOptions);
  const page = await browser.newPage();
  page.setDefaultNavigationTimeout(config.puppeteer.navigationTimeoutMs);

  return {
    browser,
    page,
    shouldDisconnectOnly: false,
    async close() {
      await page.close();
      await browser.close();
    }
  };
}

export async function scrapeCurrentPage(page, { profile, loginCredentials } = {}) {
  const title = await page.title();
  logInfo("Navigation complete", `title=${title || "(empty)"}`);

  await ensureLoggedInIfNeeded(page, profile, { loginCredentials });

  if (profile?.selectors?.row) {
    try {
      await page.waitForSelector(profile.selectors.row, {
        timeout: Number(profile?.loginWait?.timeoutMs || 15000)
      });
    } catch {
      logWarn("Row selector wait timed out", profile.selectors.row);
    }
  }

  const refreshedTitle = await page.title();

  let items;
  if (typeof profile.extractor === "function") {
    logStep("Running custom profile extractor");
    const customRawItems = await page.evaluate(profile.extractor, {
      selectors: profile.selectors || {}
    });

    items = (customRawItems || [])
      .map((item) => ({
        type: item.type || "item",
        key: trimText(item.key),
        text: trimText(item.text),
        value: trimText(item.value),
        metadata: item.metadata || null
      }))
      .filter((item) => item.text || item.value || item.key);
  } else {
    logStep("Running default selector extractor");
    const extracted = await page.evaluate((selectors) => {
      const readNodes = (selector, mapFn) =>
        Array.from(document.querySelectorAll(selector)).map(mapFn);

      const headings = readNodes(selectors.headings, (el) => ({
        text: (el.textContent || "").trim(),
        tag: el.tagName
      }));

      const links = readNodes(selectors.links, (el) => ({
        text: (el.textContent || "").trim(),
        href: el.getAttribute("href") || ""
      }));

      const paragraphs = readNodes(selectors.paragraphs, (el) => ({
        text: (el.textContent || "").trim()
      }));

      return { headings, links, paragraphs };
    }, profile.selectors);

    items = [
      ...extracted.headings.map((x) => ({
        type: "heading",
        key: x.tag,
        text: trimText(x.text),
        value: null,
        metadata: { tag: x.tag }
      })),
      ...extracted.links.map((x) => ({
        type: "link",
        key: trimText(x.href),
        text: trimText(x.text),
        value: trimText(x.href),
        metadata: null
      })),
      ...extracted.paragraphs.map((x, index) => ({
        type: "paragraph",
        key: `p-${index + 1}`,
        text: trimText(x.text),
        value: null,
        metadata: null
      }))
    ].filter((item) => item.text || item.value);
  }

  const cookies = await page.cookies(page.url());

  return {
    url: page.url(),
    title: trimText(refreshedTitle),
    fetchedAt: new Date(),
    rawItems: items,
    cookies
  };
}

export async function clickNextPage(page, profile) {
  const pagination = profile.pagination;
  if (!pagination?.enabled || !pagination.nextLinkSelector) {
    return null;
  }

  const clickedUrl = await page.evaluate((config) => {
    const links = Array.from(document.querySelectorAll(config.nextLinkSelector || ""));
    const keywords = Array.isArray(config.nextLinkTextIncludes) ? config.nextLinkTextIncludes : [];

    const matches = links.filter((link) => {
      const text = (link.textContent || "").replace(/\s+/g, "").trim();
      return keywords.length === 0 || keywords.some((keyword) => text.includes(keyword));
    });

    const candidate = matches[matches.length - 1] || null;
    const href = candidate?.getAttribute("href") || "";
    if (!candidate || !href) {
      return null;
    }

    candidate.click();
    return new URL(href, location.href).href;
  }, pagination);

  if (!clickedUrl) {
    return null;
  }

  await page.waitForNavigation({ waitUntil: "networkidle2" });
  return clickedUrl;
}

async function clickPaginationByKeywords(page, selector, keywords) {
  const clickedUrl = await page.evaluate(
    ({ selectorValue, keywordList }) => {
      const links = Array.from(document.querySelectorAll(selectorValue || ""));
      if (!links.length) {
        return null;
      }

      const normalizedKeywords = Array.isArray(keywordList) ? keywordList : [];
      const matches = links.filter((link) => {
        const text = (link.textContent || "").replace(/\s+/g, "").trim();
        return normalizedKeywords.length === 0 || normalizedKeywords.some((keyword) => text.includes(keyword));
      });

      const candidate = matches[matches.length - 1] || null;
      const href = candidate?.getAttribute("href") || "";
      if (!candidate || !href) {
        return null;
      }

      candidate.click();
      return new URL(href, location.href).href;
    },
    { selectorValue: selector, keywordList: keywords }
  );

  if (!clickedUrl) {
    return null;
  }

  await page.waitForNavigation({ waitUntil: "networkidle2" });
  return clickedUrl;
}

export async function jumpToLastPage(page, profile) {
  const pagination = profile.pagination;
  if (!pagination?.enabled || !pagination.navLinkSelector) {
    return null;
  }

  return clickPaginationByKeywords(page, pagination.navLinkSelector, pagination.lastLinkTextIncludes || []);
}

export async function clickPreviousPage(page, profile) {
  const pagination = profile.pagination;
  if (!pagination?.enabled || !pagination.navLinkSelector) {
    return null;
  }

  return clickPaginationByKeywords(page, pagination.navLinkSelector, pagination.prevLinkTextIncludes || []);
}

export async function scrapePage({ url, profile, headlessOverride, loginCredentials }) {
  const session = await createScrapeSession({ headlessOverride });

  try {
    logStep("Opening new page");
    const { page } = session;
    logStep("Navigating to target page", url);
    await page.goto(url, { waitUntil: "networkidle2" });

    return scrapeCurrentPage(page, { profile, loginCredentials });
  } finally {
    await session.close();
  }
}
