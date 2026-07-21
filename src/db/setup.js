import { pool } from "./pool.js";

async function ensureColumn(tableName, columnName, columnDefinition) {
  const [rows] = await pool.query(
    `
      SELECT COUNT(*) AS count
      FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = ?
        AND column_name = ?
    `,
    [tableName, columnName]
  );

  if (rows[0].count === 0) {
    await pool.query(`ALTER TABLE ${tableName} ADD COLUMN ${columnDefinition}`);
  }
}

async function dropColumnIfExists(tableName, columnName) {
  const [rows] = await pool.query(
    `
      SELECT COUNT(*) AS count
      FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = ?
        AND column_name = ?
    `,
    [tableName, columnName]
  );

  if (rows[0].count > 0) {
    await pool.query(`ALTER TABLE ${tableName} DROP COLUMN ${columnName}`);
  }
}

async function tableExists(tableName) {
  const [rows] = await pool.query(
    `
      SELECT COUNT(*) AS count
      FROM information_schema.tables
      WHERE table_schema = DATABASE()
        AND table_name = ?
    `,
    [tableName]
  );

  return rows[0].count > 0;
}

async function ensureIndex(tableName, indexName, indexDefinitionSql) {
  const [rows] = await pool.query(
    `
      SELECT COUNT(*) AS count
      FROM information_schema.statistics
      WHERE table_schema = DATABASE()
        AND table_name = ?
        AND index_name = ?
    `,
    [tableName, indexName]
  );

  if (rows[0].count === 0) {
    await pool.query(`ALTER TABLE ${tableName} ADD ${indexDefinitionSql}`);
  }
}

export async function ensureSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_users (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      username VARCHAR(64) NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      role VARCHAR(32) NOT NULL DEFAULT 'admin',
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uk_username (username)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS auth_sessions (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      user_id BIGINT UNSIGNED NOT NULL,
      token_hash CHAR(64) NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      expires_at DATETIME NOT NULL,
      last_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      user_agent VARCHAR(255) NULL,
      ip_address VARCHAR(64) NULL,
      PRIMARY KEY (id),
      UNIQUE KEY uk_token_hash (token_hash),
      KEY idx_user_id (user_id),
      KEY idx_expires_at (expires_at),
      CONSTRAINT fk_auth_sessions_user_id FOREIGN KEY (user_id) REFERENCES app_users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS color_palettes (
      color_index TINYINT UNSIGNED NOT NULL,
      bg_color VARCHAR(32) NOT NULL,
      color_name VARCHAR(64) NULL,
      sort_priority TINYINT UNSIGNED NULL,
      PRIMARY KEY (color_index),
      UNIQUE KEY uk_bg_color (bg_color)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await ensureColumn(
    "color_palettes",
    "sort_priority",
    "sort_priority TINYINT UNSIGNED NULL AFTER color_name"
  );

  await ensureIndex(
    "color_palettes",
    "uk_sort_priority",
    "UNIQUE KEY uk_sort_priority (sort_priority)"
  );

  await pool.query(`
    INSERT IGNORE INTO color_palettes (color_index, bg_color, color_name, sort_priority) VALUES
      (1, 'rgb(255, 148, 74)', '1 Orange', 2),
      (2, 'rgb(255, 0, 255)', '2 Magenta', 1),
      (3, 'rgb(255, 247, 0)', '3 Yellow', 3),
      (4, 'rgb(0, 181, 74)', '4 Green', 4),
      (5, 'rgb(0, 181, 255)', '5 Sky', 5),
      (6, 'rgb(156, 82, 156)', '6 Purple', 6),
      (7, 'rgb(0, 0, 255)', '7 Blue', 7),
      (8, 'rgb(0, 255, 0)', '8 Lime', 8),
      (9, 'rgb(255, 0, 0)', '9 Red', 9);
  `);

  await pool.query(`
    UPDATE color_palettes
    SET sort_priority = CASE color_index
      WHEN 2 THEN 1
      WHEN 1 THEN 2
      WHEN 3 THEN 3
      WHEN 4 THEN 4
      WHEN 5 THEN 5
      WHEN 6 THEN 6
      WHEN 7 THEN 7
      WHEN 8 THEN 8
      WHEN 9 THEN 9
      ELSE sort_priority
    END
    WHERE sort_priority IS NULL
  `);

  if (await tableExists("color_preferences")) {
    await pool.query(`
      UPDATE color_palettes cp
      JOIN color_preferences pref ON pref.color_index = cp.color_index
      SET
        cp.sort_priority = pref.sort_priority + 100,
        cp.color_name = COALESCE(NULLIF(pref.alias_name, ''), cp.color_name)
    `);

    await pool.query(`
      UPDATE color_palettes
      SET sort_priority = sort_priority - 100
      WHERE sort_priority > 100
    `);

    await pool.query("DROP TABLE color_preferences");
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS favorite_circles (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      circle_id VARCHAR(32) NOT NULL,
      color_index TINYINT UNSIGNED NULL,
      booth_location VARCHAR(128) NULL,
      circle_name VARCHAR(255) NOT NULL,
      genre VARCHAR(64) NULL,
      memo VARCHAR(2048) NULL,
      local_image_paths_json JSON NULL,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uk_circle_id (circle_id),
      KEY idx_booth_location (booth_location),
      KEY idx_genre (genre),
      KEY idx_updated_at (updated_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await ensureColumn(
    "favorite_circles",
    "local_image_paths_json",
    "local_image_paths_json JSON NULL AFTER memo"
  );

  await ensureColumn(
    "favorite_circles",
    "color_index",
    "color_index TINYINT UNSIGNED NULL AFTER circle_id"
  );

  await ensureColumn(
    "favorite_circles",
    "author_name",
    "author_name VARCHAR(255) NULL AFTER circle_name"
  );

  await ensureColumn(
    "favorite_circles",
    "pixiv_id",
    "pixiv_id VARCHAR(128) NULL AFTER memo"
  );

  await ensureColumn(
    "favorite_circles",
    "twitter_id",
    "twitter_id VARCHAR(128) NULL AFTER pixiv_id"
  );

  await ensureColumn(
    "favorite_circles",
    "tags_text",
    "tags_text TEXT NULL AFTER twitter_id"
  );

  await ensureColumn(
    "favorite_circles",
    "supplement_text",
    "supplement_text TEXT NULL AFTER tags_text"
  );

  await dropColumnIfExists("favorite_circles", "color");

  await dropColumnIfExists("favorite_circles", "image_urls_json");
}
