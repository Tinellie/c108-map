import { pool } from "../db/pool.js";

export async function getColorPreferences() {
  const [rows] = await pool.query(
    `
      SELECT color_index, sort_priority, color_name
      FROM color_palettes
      ORDER BY sort_priority ASC, color_index ASC
    `
  );

  return rows.map((row) => ({
    color_index: Number(row.color_index),
    sort_priority: Number(row.sort_priority),
    alias_name: row.color_name || ""
  }));
}

function normalizeAlias(value) {
  return String(value || "").trim().slice(0, 64);
}

export async function saveColorPreferences(items) {
  if (!Array.isArray(items) || items.length === 0) {
    const error = new Error("items must be a non-empty array");
    error.code = "INVALID_INPUT";
    throw error;
  }

  const normalized = items.map((item) => ({
    color_index: Number(item?.color_index),
    sort_priority: Number(item?.sort_priority),
    alias_name: normalizeAlias(item?.alias_name)
  }));

  const colorSet = new Set(normalized.map((item) => item.color_index));
  const prioritySet = new Set(normalized.map((item) => item.sort_priority));
  if (colorSet.size !== normalized.length || prioritySet.size !== normalized.length) {
    const error = new Error("color_index and sort_priority must be unique");
    error.code = "INVALID_INPUT";
    throw error;
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    for (const item of normalized) {
      if (!Number.isFinite(item.color_index) || !Number.isFinite(item.sort_priority)) {
        const error = new Error("color_index and sort_priority must be numbers");
        error.code = "INVALID_INPUT";
        throw error;
      }
    }

    const [existingRows] = await conn.query(
      "SELECT color_index FROM color_palettes WHERE color_index IN (?)",
      [normalized.map((item) => item.color_index)]
    );

    if (existingRows.length !== normalized.length) {
      const error = new Error("one or more color_index values do not exist in color_palettes");
      error.code = "INVALID_INPUT";
      throw error;
    }

    // Phase 1: move priorities away from target range to avoid unique key conflicts.
    await conn.query(
      "UPDATE color_palettes SET sort_priority = sort_priority + 100 WHERE color_index IN (?)",
      [normalized.map((item) => item.color_index)]
    );

    // Phase 2: write final priority and alias values.
    for (const item of normalized) {
      await conn.query(
        `
          UPDATE color_palettes
          SET sort_priority = ?, color_name = ?
          WHERE color_index = ?
        `,
        [item.sort_priority, item.alias_name || null, item.color_index]
      );
    }

    await conn.commit();
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}