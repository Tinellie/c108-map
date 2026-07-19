export const DEFAULT_COLOR_SORT_ORDER = [2, 1, 3, 4, 5, 6, 7, 8, 9];

export const COLOR_LABELS = {
  1: "1 Orange",
  2: "2 Magenta",
  3: "3 Yellow",
  4: "4 Green",
  5: "5 Sky",
  6: "6 Purple",
  7: "7 Blue",
  8: "8 Lime",
  9: "9 Red"
};

export const DEFAULT_COLOR_ALIASES = { ...COLOR_LABELS };

export const LOCATION_DAY_FILTER_OPTIONS = [
  { value: "all", label: "全部日数" },
  { value: "day1", label: "一日目(土)" },
  { value: "day2", label: "二日目(日)" }
];

export const LOCATION_VENUE_FILTER_OPTIONS = [
  { value: "all", label: "全部场馆" },
  { value: "east-large", label: "东" },
  { value: "east-small", label: "东7" },
  { value: "west", label: "西馆" },
  { value: "south", label: "南馆" }
];

const WEEKDAY_ORDER = {
  "月曜日": 1,
  "火曜日": 2,
  "水曜日": 3,
  "木曜日": 4,
  "金曜日": 5,
  "土曜日": 6,
  "日曜日": 7
};

const HALL_ORDER = {
  "東": 1,
  "西": 2,
  "南": 3
};

const SUFFIX_ORDER = {
  a: 1,
  b: 2,
  ab: 3,
  "": 4
};

const ROMAJI_TO_HIRAGANA = {
  a: "あ",
  i: "い",
  u: "う",
  e: "え",
  o: "お",
  ka: "か",
  ki: "き",
  ku: "く",
  ke: "け",
  ko: "こ",
  sa: "さ",
  shi: "し",
  si: "し",
  su: "す",
  se: "せ",
  so: "そ",
  ta: "た",
  chi: "ち",
  ti: "ち",
  tsu: "つ",
  tu: "つ",
  te: "て",
  to: "と",
  na: "な",
  ni: "に",
  nu: "ぬ",
  ne: "ね",
  no: "の",
  ha: "は",
  hi: "ひ",
  fu: "ふ",
  hu: "ふ",
  he: "へ",
  ho: "ほ",
  ma: "ま",
  mi: "み",
  mu: "む",
  me: "め",
  mo: "も",
  ya: "や",
  yu: "ゆ",
  yo: "よ",
  ra: "ら",
  ri: "り",
  ru: "る",
  re: "れ",
  ro: "ろ",
  wa: "わ",
  wo: "を",
  n: "ん",
  ga: "が",
  gi: "ぎ",
  gu: "ぐ",
  ge: "げ",
  go: "ご",
  za: "ざ",
  ji: "じ",
  zi: "じ",
  zu: "ず",
  ze: "ぜ",
  zo: "ぞ",
  da: "だ",
  de: "で",
  do: "ど",
  ba: "ば",
  bi: "び",
  bu: "ぶ",
  be: "べ",
  bo: "ぼ",
  pa: "ぱ",
  pi: "ぴ",
  pu: "ぷ",
  pe: "ぺ",
  po: "ぽ"
};

export function parseImageList(rawValue) {
  if (Array.isArray(rawValue)) {
    return rawValue;
  }

  if (!rawValue) {
    return [];
  }

  if (typeof rawValue === "string") {
    try {
      const parsed = JSON.parse(rawValue);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  return [];
}

export function normalizeCircle(row) {
  return {
    id: Number(row.id) || null,
    circle_id: String(row.circle_id || ""),
    circle_name: row.circle_name || "(No Name)",
    booth_location: row.booth_location || "",
    genre: row.genre || "",
    author_name: row.author_name || "",
    pixiv_id: row.pixiv_id || "",
    twitter_id: row.twitter_id || "",
    tags_text: row.tags_text || "",
    supplement_text: row.supplement_text || "",
    memo: row.memo || "",
    color_index: Number(row.color_index) || null,
    updated_at: row.updated_at || "",
    local_image_paths: parseImageList(row.local_image_paths_json || row.local_image_paths)
  };
}

export function badgeColor(index) {
  const colorMap = {
    1: "#FF944A",
    2: "#FF00FF",
    3: "#FFF700",
    4: "#00B54A",
    5: "#00B5FF",
    6: "#9C529C",
    7: "#0000FF",
    8: "#00FF00",
    9: "#FF0000"
  };

  return colorMap[index] || "#9CA3AF";
}

export function toImageUrl(imageBaseUrl, imagePath) {
  if (!imagePath) {
    return "";
  }

  return imageBaseUrl
    ? `${imageBaseUrl.replace(/\/$/, "")}/${String(imagePath).replace(/^\//, "")}`
    : String(imagePath);
}

export function getPixivProfileUrl(pixivId) {
  return pixivId ? `https://www.pixiv.net/users/${pixivId}` : "";
}

export function getTwitterProfileUrl(twitterId) {
  return twitterId ? `https://x.com/${twitterId}` : "";
}

export function getCircleDetailUrl(circleId) {
  return circleId ? `https://webcatalog.circle.ms/Circle/${circleId}` : "";
}

export function getCircleMapUrl(circleId) {
  return circleId ? `https://webcatalog.circle.ms/Circle/Map/${circleId}/0` : "";
}

export function statsFromRows(rows) {
  return {
    total: rows.length,
    withPixiv: rows.filter((item) => item.pixiv_id).length,
    withTwitter: rows.filter((item) => item.twitter_id).length,
    withTags: rows.filter((item) => item.tags_text).length
  };
}

export async function fetchAllCirclesFromApi(apiUrl, pageSize) {
  const allRows = [];
  let offset = 0;
  const safePageSize = Math.min(Math.max(pageSize, 1), 200);
  let total = Number.MAX_SAFE_INTEGER;

  while (offset < total) {
    const separator = apiUrl.includes("?") ? "&" : "?";
    const url = `${apiUrl}${separator}limit=${safePageSize}&offset=${offset}`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`API ${response.status}`);
    }

    const payload = await response.json();
    const rows = Array.isArray(payload) ? payload : payload?.data || [];
    const pageTotal = Number(payload?.pagination?.total);
    if (Number.isFinite(pageTotal)) {
      total = pageTotal;
    }

    allRows.push(...rows);

    if (!rows.length || rows.length < safePageSize) {
      break;
    }

    offset += rows.length;
  }

  return allRows;
}

export function compareNumbers(a, b) {
  if (a === b) {
    return 0;
  }

  return a > b ? 1 : -1;
}

export function parseLocation(location) {
  const raw = String(location || "").trim();
  const match = raw.match(/^(月曜日|火曜日|水曜日|木曜日|金曜日|土曜日|日曜日)\s+([東西南])([^\d\s])(\d+)(ab|a|b)?$/i);
  if (!match) {
    return {
      isValid: false,
      weekdayOrder: Number.MAX_SAFE_INTEGER,
      hallOrder: Number.MAX_SAFE_INTEGER,
      islandCode: "",
      boothNumber: Number.MAX_SAFE_INTEGER,
      suffixOrder: Number.MAX_SAFE_INTEGER,
      suffixText: "",
      weekdayText: "",
      hallText: "",
      raw
    };
  }

  const weekday = match[1];
  const hall = match[2];
  const islandCode = match[3] || "";
  const boothNumber = Number(match[4] || Number.MAX_SAFE_INTEGER);
  const suffix = String(match[5] || "").toLowerCase();

  return {
    isValid: true,
    weekdayOrder: WEEKDAY_ORDER[weekday] || Number.MAX_SAFE_INTEGER,
    hallOrder: HALL_ORDER[hall] || Number.MAX_SAFE_INTEGER,
    islandCode,
    boothNumber,
    suffixOrder: SUFFIX_ORDER[suffix] || Number.MAX_SAFE_INTEGER,
    suffixText: suffix,
    weekdayText: weekday,
    hallText: hall,
    raw
  };
}

function islandTypeRank(value) {
  if (!value) {
    return 3;
  }

  const firstChar = String(value).charAt(0);
  if (/^[\u3040-\u30FF\u31F0-\u31FF\uFF66-\uFF9D]$/.test(firstChar)) {
    return 1;
  }

  if (/^[A-Za-z\uFF21-\uFF3A\uFF41-\uFF5A]$/.test(firstChar)) {
    return 2;
  }

  return 3;
}

function isKatakanaChar(value) {
  return /^[\u30A0-\u30FF\u31F0-\u31FF\uFF66-\uFF9D]$/.test(String(value || "").charAt(0));
}

function isLatinLetterChar(value) {
  return /^[A-Za-z\uFF21-\uFF3A\uFF41-\uFF5A]$/.test(String(value || "").charAt(0));
}

export function getVenueCategory(location) {
  const parsed = parseLocation(location);
  if (!parsed.isValid) {
    return "other";
  }

  if (parsed.hallText === "東") {
    if (isKatakanaChar(parsed.islandCode)) {
      return "east-large";
    }

    if (isLatinLetterChar(parsed.islandCode)) {
      return "east-small";
    }

    return "other";
  }

  if (parsed.hallText === "西") {
    return "west";
  }

  if (parsed.hallText === "南") {
    return "south";
  }

  return "other";
}

export function getDayCategory(location) {
  const parsed = parseLocation(location);
  if (!parsed.isValid) {
    return "other";
  }

  if (parsed.weekdayText === "土曜日") {
    return "day1";
  }

  if (parsed.weekdayText === "日曜日") {
    return "day2";
  }

  return "other";
}

export function compareIslandCode(aValue, bValue) {
  const aRank = islandTypeRank(aValue);
  const bRank = islandTypeRank(bValue);
  const byType = compareNumbers(aRank, bRank);
  if (byType !== 0) {
    return byType;
  }

  return String(aValue || "").localeCompare(String(bValue || ""), "ja", { sensitivity: "variant" });
}

export function getLocationLine1(location) {
  const parsed = parseLocation(location);
  if (!parsed.isValid) {
    return location || "-";
  }

  return `${parsed.hallText}${parsed.islandCode}${parsed.boothNumber}${parsed.suffixText}`;
}

export function getLocationLine2(location) {
  const parsed = parseLocation(location);
  if (!parsed.isValid) {
    return "";
  }

  if (parsed.weekdayText === "土曜日") {
    return "一日目";
  }

  if (parsed.weekdayText === "日曜日") {
    return "二日目";
  }

  return parsed.weekdayText;
}

function hiraganaToKatakana(value) {
  return String(value || "").replace(/[ぁ-ゖ]/g, (char) => String.fromCharCode(char.charCodeAt(0) + 0x60));
}

function buildKanaAddressQuery(keyword) {
  const raw = String(keyword || "").trim();
  const match = raw.match(/^#([A-Za-z]+)(\d+)(ab|a|b)?$/);
  if (!match) {
    return null;
  }

  const romajiSource = match[1] || "";
  const useKatakana = /^[A-Z]/.test(romajiSource);
  const romaji = romajiSource.toLowerCase();
  const kanaBase = ROMAJI_TO_HIRAGANA[romaji];
  if (!kanaBase) {
    return null;
  }

  const kana = useKatakana ? hiraganaToKatakana(kanaBase) : kanaBase;
  return `${kana}${match[2]}${(match[3] || "").toLowerCase()}`;
}

function buildLatinAddressQuery(keyword) {
  const raw = String(keyword || "").trim();
  const match = raw.match(/^@([A-Za-zＡ-Ｚａ-ｚ])(\d+)(ab|a|b)?$/i);
  if (!match) {
    return null;
  }

  const islandCode = String(match[1] || "").replace(/[A-Za-z]/g, (char) => {
    const code = char.charCodeAt(0);
    return String.fromCharCode(code + 0xFEE0);
  });

  return `${islandCode}${match[2] || ""}${String(match[3] || "").toLowerCase()}`;
}

function getLocationKanaAddress(location) {
  const parsed = parseLocation(location);
  if (!parsed.isValid) {
    return "";
  }

  return `${parsed.islandCode}${parsed.boothNumber}${parsed.suffixText}`;
}

export function filterRows(rows, search, locationFilters = {}) {
  const daySelections = Array.isArray(locationFilters.days)
    ? locationFilters.days
    : locationFilters.day && locationFilters.day !== "all"
      ? [locationFilters.day]
      : [];
  const venueSelections = Array.isArray(locationFilters.venues)
    ? locationFilters.venues
    : locationFilters.venue && locationFilters.venue !== "all"
      ? [locationFilters.venue]
      : [];

  const daySet = new Set(daySelections.map((item) => String(item)));
  const venueSet = new Set(venueSelections.map((item) => String(item)));

  // In multi-select mode, selecting nothing means show nothing.
  if (Array.isArray(locationFilters.days) && daySet.size === 0) {
    return [];
  }

  if (Array.isArray(locationFilters.venues) && venueSet.size === 0) {
    return [];
  }

  const locationFiltered = rows.filter((row) => {
    const dayCategory = getDayCategory(row.booth_location);
    const venueCategory = getVenueCategory(row.booth_location);
    const dayMatched = daySet.size === 0 || daySet.has(dayCategory);
    const venueMatched = venueSet.size === 0 || venueSet.has(venueCategory);
    return dayMatched && venueMatched;
  });

  const keyword = search.trim().toLowerCase();
  if (!keyword) {
    return locationFiltered;
  }

  const kanaAddressQuery = buildKanaAddressQuery(search.trim());
  if (kanaAddressQuery) {
    return locationFiltered.filter((row) => {
      const locationKanaAddress = getLocationKanaAddress(row.booth_location);
      const locationLine1 = getLocationLine1(row.booth_location);
      return locationKanaAddress.includes(kanaAddressQuery) || locationLine1.includes(kanaAddressQuery);
    });
  }

  const latinAddressQuery = buildLatinAddressQuery(search.trim());
  if (latinAddressQuery) {
    const loweredLatinAddressQuery = latinAddressQuery.toLowerCase();
    return locationFiltered.filter((row) => {
      const locationKanaAddress = getLocationKanaAddress(row.booth_location).toLowerCase();
      const locationLine1 = getLocationLine1(row.booth_location).toLowerCase();
      return (
        locationKanaAddress.includes(loweredLatinAddressQuery) ||
        locationLine1.includes(loweredLatinAddressQuery)
      );
    });
  }

  return locationFiltered.filter((row) =>
    [
      row.circle_id,
      row.circle_name,
      row.booth_location,
      row.genre,
      row.author_name,
      row.tags_text,
      row.pixiv_id,
      row.twitter_id
    ]
      .join(" ")
      .toLowerCase()
      .includes(keyword)
  );
}

export function normalizeColorSortOrder(rawOrder) {
  const incoming = Array.isArray(rawOrder) ? rawOrder.map((item) => Number(item)).filter(Number.isFinite) : [];
  const unique = [];

  for (const value of incoming) {
    if (!DEFAULT_COLOR_SORT_ORDER.includes(value) || unique.includes(value)) {
      continue;
    }
    unique.push(value);
  }

  for (const value of DEFAULT_COLOR_SORT_ORDER) {
    if (!unique.includes(value)) {
      unique.push(value);
    }
  }

  return unique;
}

export function compareRegistrationOrder(a, b) {
  const aId = Number(a.id) || Number.MAX_SAFE_INTEGER;
  const bId = Number(b.id) || Number.MAX_SAFE_INTEGER;
  if (aId !== bId) {
    return compareNumbers(aId, bId);
  }

  return compareNumbers(Number(a.circle_id) || Number.MAX_SAFE_INTEGER, Number(b.circle_id) || Number.MAX_SAFE_INTEGER);
}

export function compareColorOrder(a, b, colorSortOrder) {
  const orderMap = new Map(colorSortOrder.map((value, index) => [value, index]));
  const aRank = orderMap.has(a.color_index) ? orderMap.get(a.color_index) : Number.MAX_SAFE_INTEGER;
  const bRank = orderMap.has(b.color_index) ? orderMap.get(b.color_index) : Number.MAX_SAFE_INTEGER;
  const byColor = compareNumbers(aRank, bRank);
  if (byColor !== 0) {
    return byColor;
  }

  return compareLocationOrder(a, b);
}

export function compareLocationOrder(a, b) {
  const aLoc = parseLocation(a.booth_location);
  const bLoc = parseLocation(b.booth_location);

  const byWeekday = compareNumbers(aLoc.weekdayOrder, bLoc.weekdayOrder);
  if (byWeekday !== 0) {
    return byWeekday;
  }

  const byHall = compareNumbers(aLoc.hallOrder, bLoc.hallOrder);
  if (byHall !== 0) {
    return byHall;
  }

  const byIsland = compareIslandCode(aLoc.islandCode, bLoc.islandCode);
  if (byIsland !== 0) {
    return byIsland;
  }

  const byBoothNumber = compareNumbers(aLoc.boothNumber, bLoc.boothNumber);
  if (byBoothNumber !== 0) {
    return byBoothNumber;
  }

  const bySuffix = compareNumbers(aLoc.suffixOrder, bLoc.suffixOrder);
  if (bySuffix !== 0) {
    return bySuffix;
  }

  return compareRegistrationOrder(a, b);
}

export function sortRows(rows, sortMode, sortDirection, colorSortOrder) {
  const copy = [...rows];
  if (sortMode === "color") {
    copy.sort((a, b) => compareColorOrder(a, b, colorSortOrder));
  } else if (sortMode === "location") {
    copy.sort(compareLocationOrder);
  } else {
    copy.sort(compareRegistrationOrder);
  }

  if (sortDirection === "desc") {
    copy.reverse();
  }

  return copy;
}

export async function fetchColorPreferences(apiUrl) {
  const response = await fetch(apiUrl);
  if (!response.ok) {
    throw new Error(`API ${response.status}`);
  }

  const payload = await response.json();
  const items = Array.isArray(payload?.data) ? payload.data : [];
  return items.map((item) => ({
    color_index: Number(item.color_index),
    sort_priority: Number(item.sort_priority),
    alias_name: String(item.alias_name || "")
  }));
}

export async function saveColorPreferences(apiUrl, items) {
  const response = await fetch(apiUrl, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items })
  });

  if (!response.ok) {
    let message = `API ${response.status}`;
    try {
      const payload = await response.json();
      message = payload?.message || message;
    } catch {
      // ignore
    }
    throw new Error(message);
  }

  const payload = await response.json();
  return Array.isArray(payload?.data) ? payload.data : [];
}

export function normalizeColorAliases(rawAliases) {
  const source = rawAliases && typeof rawAliases === "object" ? rawAliases : {};
  const aliases = {};

  for (const key of Object.keys(COLOR_LABELS)) {
    const colorIndex = Number(key);
    const alias = String(source[colorIndex] ?? source[key] ?? "").trim();
    aliases[colorIndex] = alias || COLOR_LABELS[colorIndex];
  }

  return aliases;
}

export function colorPreferenceItemsToState(items) {
  const safeItems = Array.isArray(items) ? items : [];
  const sorted = [...safeItems].sort((a, b) => compareNumbers(Number(a.sort_priority), Number(b.sort_priority)));

  const order = normalizeColorSortOrder(sorted.map((item) => Number(item.color_index)));
  const aliases = normalizeColorAliases(
    Object.fromEntries(sorted.map((item) => [Number(item.color_index), String(item.alias_name || "")]))
  );

  return { order, aliases };
}