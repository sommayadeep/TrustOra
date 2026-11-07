import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { updateInitialEnv } from "@next/env";
import { WEB_APP_DIR, loadWebEnv } from "../scripts/load-web-env";

const VAR = "TRUSTORA_LOADER_TEST_VALUE";

function withAppDir(files: Record<string, string>, body: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "trustora-env-"));
  const original = process.env[VAR];
  try {
    for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
    body(dir);
  } finally {
    if (original === undefined) delete process.env[VAR];
    else process.env[VAR] = original;
    rmSync(dir, { recursive: true, force: true });
  }
}

test("the default target is the real apps/web directory", () => {
  assert.equal(existsSync(join(WEB_APP_DIR, "next.config.mjs")), true);
  assert.equal(WEB_APP_DIR, fileURLToPath(new URL("../../../apps/web/", import.meta.url)));
});

test("reads .env and reports file names only, never contents", () => {
  withAppDir({ ".env": `export ${VAR}=from-dotenv # trailing comment\n` }, (dir) => {
    const result = loadWebEnv(dir);
    assert.equal(process.env[VAR], "from-dotenv");
    assert.deepEqual(result.loadedFiles, [".env"]);
    assert.doesNotMatch(JSON.stringify(result), /from-dotenv/);
  });
});

test(".env.local overrides .env, exactly as Next.js resolves them for the app", () => {
  withAppDir({ ".env": `${VAR}=from-dotenv\n`, ".env.local": `${VAR}=from-local\n` }, (dir) => {
    const result = loadWebEnv(dir);
    assert.equal(process.env[VAR], "from-local");
    assert.deepEqual(result.loadedFiles, [".env.local", ".env"]);
  });
});

test("a real process environment variable wins over any file", () => {
  // @next/env snapshots the process environment once, at its first load, so a variable set from the
  // shell has to be in that snapshot. A name of its own keeps it from affecting the other tests.
  const name = "TRUSTORA_LOADER_TEST_SHELL_VALUE";
  updateInitialEnv({ [name]: "from-shell" });
  try {
    withAppDir({ ".env": `${name}=from-dotenv\n` }, (dir) => {
      loadWebEnv(dir);
      assert.equal(process.env[name], "from-shell");
    });
  } finally {
    delete process.env[name];
  }
});

test("a directory with no env files reports none instead of failing silently", () => {
  withAppDir({}, (dir) => {
    assert.deepEqual(loadWebEnv(dir).loadedFiles, []);
  });
});
