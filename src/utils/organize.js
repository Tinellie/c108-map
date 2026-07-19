function normalizeText(text) {
  return (text || "").replace(/\s+/g, " ").trim();
}

function dedupeItems(items) {
  const seen = new Set();
  const result = [];

  for (const item of items) {
    const fingerprint = [item.type, item.key || "", item.text || "", item.value || ""].join("|");
    if (seen.has(fingerprint)) {
      continue;
    }

    seen.add(fingerprint);
    result.push(item);
  }

  return result;
}

export function organizeItems(rawItems) {
  const cleaned = rawItems
    .map((item) => ({
      ...item,
      key: normalizeText(item.key),
      text: normalizeText(item.text),
      value: normalizeText(item.value)
    }))
    .filter((item) => item.text || item.value);

  return dedupeItems(cleaned);
}
