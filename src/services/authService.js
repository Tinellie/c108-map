import crypto from "node:crypto";
import { promisify } from "node:util";
import { pool } from "../db/pool.js";

const scryptAsync = promisify(crypto.scrypt);

function nowPlusHours(hours) {
  const next = new Date();
  next.setHours(next.getHours() + Number(hours || 0));
  return next;
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

export async function hashPassword(plainPassword) {
  const password = String(plainPassword || "");
  if (password.length < 8) {
    throw new Error("password must be at least 8 characters");
  }

  const salt = crypto.randomBytes(16).toString("hex");
  const derived = await scryptAsync(password, salt, 64);
  return `${salt}:${Buffer.from(derived).toString("hex")}`;
}

export async function verifyPassword(plainPassword, storedHash) {
  const [salt, hashHex] = String(storedHash || "").split(":");
  if (!salt || !hashHex) {
    return false;
  }

  const derived = await scryptAsync(String(plainPassword || ""), salt, 64);
  const expected = Buffer.from(hashHex, "hex");
  const actual = Buffer.from(derived);

  if (expected.length !== actual.length) {
    return false;
  }

  return crypto.timingSafeEqual(expected, actual);
}

export async function ensureBootstrapUser({ username, password }) {
  const [rows] = await pool.query("SELECT COUNT(*) AS count FROM app_users");
  const total = Number(rows[0]?.count || 0);
  if (total > 0) {
    return;
  }

  let resolvedUsername = String(username || "").trim();
  let resolvedPassword = String(password || "");

  if (!resolvedUsername || !resolvedPassword) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("No users found. Set AUTH_BOOTSTRAP_USERNAME and AUTH_BOOTSTRAP_PASSWORD to create the first admin user.");
    }

    resolvedUsername = "admin";
    resolvedPassword = "admin123!";
    console.warn("[auth] No bootstrap credentials configured; created default dev admin user 'admin'. Please change immediately.");
  }

  const passwordHash = await hashPassword(resolvedPassword);
  await pool.query(
    "INSERT INTO app_users (username, password_hash, role, is_active) VALUES (?, ?, 'admin', 1)",
    [resolvedUsername, passwordHash]
  );
}

export async function findActiveUserByUsername(username) {
  const normalized = String(username || "").trim();
  if (!normalized) {
    return null;
  }

  const [rows] = await pool.query(
    "SELECT id, username, password_hash, role, is_active FROM app_users WHERE username = ? LIMIT 1",
    [normalized]
  );

  const user = rows[0] || null;
  if (!user || !Number(user.is_active)) {
    return null;
  }

  return user;
}

export async function createSessionForUser(userId, { ttlHours, userAgent, ipAddress } = {}) {
  const token = crypto.randomBytes(32).toString("base64url");
  const tokenHash = sha256(token);
  const expiresAt = nowPlusHours(ttlHours || 8);

  await pool.query(
    `
      INSERT INTO auth_sessions
        (user_id, token_hash, expires_at, user_agent, ip_address)
      VALUES (?, ?, ?, ?, ?)
    `,
    [
      Number(userId),
      tokenHash,
      expiresAt,
      String(userAgent || "").slice(0, 255) || null,
      String(ipAddress || "").slice(0, 64) || null
    ]
  );

  return {
    token,
    expiresAt
  };
}

export async function resolveUserBySessionToken(sessionToken) {
  const token = String(sessionToken || "");
  if (!token) {
    return null;
  }

  const tokenHash = sha256(token);
  const [rows] = await pool.query(
    `
      SELECT
        s.id AS session_id,
        s.expires_at,
        u.id,
        u.username,
        u.role,
        u.is_active
      FROM auth_sessions s
      JOIN app_users u ON u.id = s.user_id
      WHERE s.token_hash = ?
      LIMIT 1
    `,
    [tokenHash]
  );

  const row = rows[0] || null;
  if (!row || !Number(row.is_active)) {
    return null;
  }

  const expiresAt = new Date(row.expires_at);
  if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= Date.now()) {
    await pool.query("DELETE FROM auth_sessions WHERE token_hash = ?", [tokenHash]);
    return null;
  }

  await pool.query("UPDATE auth_sessions SET last_seen_at = CURRENT_TIMESTAMP WHERE id = ?", [row.session_id]);

  return {
    id: Number(row.id),
    username: String(row.username || ""),
    role: String(row.role || "user")
  };
}

export async function revokeSessionByToken(sessionToken) {
  const token = String(sessionToken || "");
  if (!token) {
    return;
  }

  await pool.query("DELETE FROM auth_sessions WHERE token_hash = ?", [sha256(token)]);
}

export async function purgeExpiredSessions() {
  await pool.query("DELETE FROM auth_sessions WHERE expires_at <= CURRENT_TIMESTAMP");
}
