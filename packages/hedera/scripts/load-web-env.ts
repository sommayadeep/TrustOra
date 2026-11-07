/**
 * Loads the web app's environment with @next/env, the loader Next.js itself uses, so the preflight
 * sees the same values as the running app: same files, same precedence (.env.local over .env), same
 * parsing, and real process environment variables still win.
 *
 * Returns file names only. It never returns or logs anything read from those files.
 */
import { basename } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnvConfig } from "@next/env";

export const WEB_APP_DIR = fileURLToPath(new URL("../../../apps/web/", import.meta.url));

const SILENT = { info: () => {}, error: () => {} };

export function loadWebEnv(appDir: string = WEB_APP_DIR): { loadedFiles: string[] } {
  // `next dev` loads development files; `next build` and `next start` load production ones.
  const dev = process.env.NODE_ENV !== "production";
  const { loadedEnvFiles } = loadEnvConfig(appDir, dev, SILENT, true);
  return { loadedFiles: loadedEnvFiles.map((file) => basename(file.path)) };
}
