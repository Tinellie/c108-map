import { pool } from "../db/pool.js";

function normalizeColor(value) {
  const match = String(value || "").match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
  if (!match) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  return `rgb(${match[1]}, ${match[2]}, ${match[3]})`;
}

export async function loadColorPaletteMap() {
  const [rows] = await pool.query("SELECT color_index, bg_color FROM color_palettes");
  const paletteMap = new Map();

  for (const row of rows) {
    paletteMap.set(normalizeColor(row.bg_color), Number(row.color_index));
  }

  return paletteMap;
}
