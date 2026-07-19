import { pool } from "../db/pool.js";
import { logInfo, logStep } from "../utils/logger.js";

export async function loadExistingCircleIdSet() {
  const [rows] = await pool.query("SELECT circle_id FROM favorite_circles");
  return new Set(rows.map((row) => String(row.circle_id || "")).filter(Boolean));
}

export async function upsertFavoriteCircles(circles) {
  if (!circles.length) {
    logInfo("Skip DB upsert because circles list is empty");
    return;
  }

  logStep("Opening DB transaction", `rows=${circles.length}`);
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    for (const circle of circles) {
      await connection.query(
        `
          INSERT INTO favorite_circles
            (circle_id, color_index, booth_location, circle_name, genre, memo, local_image_paths_json)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            color_index = VALUES(color_index),
            booth_location = VALUES(booth_location),
            circle_name = VALUES(circle_name),
            genre = VALUES(genre),
            memo = VALUES(memo),
            local_image_paths_json = VALUES(local_image_paths_json)
        `,
        [
          circle.circle_id,
          circle.color_index,
          circle.booth_location,
          circle.circle_name,
          circle.genre,
          circle.memo,
          JSON.stringify(circle.local_image_paths || [])
        ]
      );
    }

    await connection.commit();
    logInfo("DB transaction committed", `rows=${circles.length}`);
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function upsertCircleDetails(detailsList) {
  if (!detailsList.length) {
    logInfo("Skip detail DB upsert because detail list is empty");
    return;
  }

  logStep("Opening detail DB transaction", `rows=${detailsList.length}`);
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    for (const detail of detailsList) {
      await connection.query(
        `
          UPDATE favorite_circles
          SET
            author_name = COALESCE(?, author_name),
            genre = COALESCE(?, genre),
            pixiv_id = ?,
            twitter_id = ?,
            tags_text = ?,
            supplement_text = ?
          WHERE circle_id = ?
        `,
        [
          detail.author_name,
          detail.genre,
          detail.pixiv_id,
          detail.twitter_id,
          detail.tags_text,
          detail.supplement_text,
          detail.circle_id
        ]
      );
    }

    await connection.commit();
    logInfo("Detail DB transaction committed", `rows=${detailsList.length}`);
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}
