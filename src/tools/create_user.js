import { pool } from "../db/pool.js";
import { ensureSchema } from "../db/setup.js";
import { hashPassword } from "../services/authService.js";

function parseCliArgs(argv) {
  const args = {};

  for (let index = 0; index < argv.length; index += 1) {
    const part = argv[index];
    if (!part.startsWith("--")) {
      continue;
    }

    const normalized = part.replace(/^--/, "");
    const separatorIndex = normalized.indexOf("=");
    const key = separatorIndex === -1 ? normalized : normalized.slice(0, separatorIndex);

    let value = "";
    if (separatorIndex !== -1) {
      value = normalized.slice(separatorIndex + 1);
    } else {
      const nextPart = argv[index + 1];
      if (typeof nextPart === "string" && !nextPart.startsWith("--")) {
        value = nextPart;
        index += 1;
      }
    }

    args[key] = value;
  }

  return args;
}

function firstNonEmptyValue(...values) {
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (text) {
      return text;
    }
  }
  return "";
}

function printHelp() {
  console.log("Usage: npm run user:create -- --username=<name> --password=<password> [--role=admin]");
}

async function main() {
  const args = parseCliArgs(process.argv.slice(2));
  // npm may consume some CLI flags (for example --username) into npm_config_* env vars.
  const username = firstNonEmptyValue(args.username, process.env.npm_config_username);
  const password = firstNonEmptyValue(args.password, process.env.npm_config_password);
  const role = firstNonEmptyValue(args.role, process.env.npm_config_role, "admin");

  if (!username || !password) {
    printHelp();
    throw new Error("username and password are required");
  }

  if (password.length < 8) {
    throw new Error("password must be at least 8 characters");
  }

  await ensureSchema();

  const [existingRows] = await pool.query(
    "SELECT id FROM app_users WHERE username = ? LIMIT 1",
    [username]
  );

  if (existingRows.length > 0) {
    throw new Error(`username already exists: ${username}`);
  }

  const passwordHash = await hashPassword(password);
  await pool.query(
    "INSERT INTO app_users (username, password_hash, role, is_active) VALUES (?, ?, ?, 1)",
    [username, passwordHash, role]
  );

  console.log(`User created: ${username} (role=${role})`);
}

main()
  .catch((error) => {
    console.error(error?.message || String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
