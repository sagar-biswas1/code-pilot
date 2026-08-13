import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
} from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

type AuthData = {
  token: string;
};

const AUTH_DIR = join(homedir(), ".code-pilot");
const AUTH_FILE = join(AUTH_DIR, "auth.json");

export function getAuth(): AuthData | null {
  try {
    const data = readFileSync(AUTH_FILE, "utf8");
    const parsed = JSON.parse(data) as Partial<AuthData>;
    return typeof parsed?.token === "string" ? { token: parsed.token } : null;
  } catch (err) {
    return null;
  }
}

export function saveAuth(data: AuthData) {
  if (!existsSync(AUTH_DIR)) {
    // Ensure the directory is created with strict permissions (only owner can read and write).
    mkdirSync(AUTH_DIR, { mode: 0o700 });
  }
  writeFileSync(AUTH_FILE, JSON.stringify(data), {
    // Ensure the file is created with strict permissions.
    mode: 0o600,
  });
}

export function deleteAuth() {
  try {
    if (existsSync(AUTH_FILE)) {
      unlinkSync(AUTH_FILE);
    }
  } catch (err) {
    console.error("Failed to delete auth file:", err);
  }
}
