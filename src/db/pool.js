import mysql from "mysql2/promise";
import { config } from "../config/env.js";

export const pool = mysql.createPool(config.db);

export async function testConnection() {
  const connection = await pool.getConnection();
  try {
    await connection.ping();
  } finally {
    connection.release();
  }
}
