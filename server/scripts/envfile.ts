import { existsSync, readFileSync, writeFileSync } from "node:fs";

const FILE = process.env.ENV_FILE ?? ".env";

export function readEnvFile(): string {
  return existsSync(FILE) ? readFileSync(FILE, "utf8") : "";
}

/** Set KEY=value in .env (replace if present, append otherwise). .env is git-ignored. */
export function setEnv(key: string, value: string): void {
  const src = readEnvFile();
  const line = `${key}=${value}`;
  const re = new RegExp(`^${key}=.*$`, "m");
  writeFileSync(FILE, re.test(src) ? src.replace(re, line) : `${src}${src && !src.endsWith("\n") ? "\n" : ""}${line}\n`);
}
