/**
 * Exercises scripts/db-safe-update.mjs on scratch databases built from the PRE-Task-2 schema, with real rows.
 * The real dev.db is never touched.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
// @ts-expect-error plain ESM script without types
import * as dbUpdate from "../scripts/db-safe-update.mjs";

const SafeUpdateError: new (message?: string) => Error = dbUpdate.SafeUpdateError;
const { describePlan, destructiveStatements, run } = dbUpdate as {
  describePlan: (sql: string) => { newTables: string[]; newColumns: string[]; newIndexes: string[] };
  destructiveStatements: (sql: string) => string[];
  run: (o: { dbPath?: string; schemaPath?: string; apply?: boolean; backupDir?: string; financialMigration?: boolean }) => any;
};

const schemaPath = join(__dirname, "../prisma/schema.prisma");
let dir: string;

/** The schema as it was before Task 2: without the new columns, tables and unique indexes. */
function oldSchema(dbFile: string): string {
  return readFileSync(schemaPath, "utf8")
    .replace("file:./dev.db", `file:${dbFile}`)
    .replace(/^\s*registerTxHash .*$/m, "")
    .replace(/^\s*addTxHash .*$/m, "")
    .replace(/^\s*content +String\?.*$/m, "")
    .replace(/^\s*anchorTxHash .*$/m, "")
    .replace(/^\s*requestedByAddress .*$/m, "")
    .replace(/@@unique\(\[projectId, referenceType, referenceValue\]\)/, "")
    .replace(/@@unique\(\[projectId, sequence\]\)/, "")
    .replace(/model AuthNonce \{[\s\S]*?\n\}\n/, "")
    .replace(/model Session \{[\s\S]*?\n\}\n/, "");
}

function makeOldDb(name: string, seed = true): string {
  const file = join(dir, `${name}.db`);
  const schema = join(dir, `${name}.prisma`);
  writeFileSync(schema, oldSchema(file));
  execFileSync(process.execPath, [require.resolve("prisma/build/index.js"), "db", "push", "--skip-generate", "--schema", schema], {
    stdio: "pipe",
    // Prisma 5.22's SQLite schema engine can return an empty `Schema engine error:` unless
    // Rust engine logging is enabled. Keep this scoped to disposable test databases.
    env: { ...process.env, RUST_LOG: "info" },
  });
  if (seed) {
    const db = new DatabaseSync(file);
    db.exec(`
      INSERT INTO "Project" (id,title,description,clientAddress,budgetUsdc,updatedAt) VALUES ('TRU-PROJ-2026-0000001','Old','d','0xc',100,CURRENT_TIMESTAMP);
      INSERT INTO "Milestone" (id,projectId,milestoneIndex,title,amountUsdc) VALUES ('m1','TRU-PROJ-2026-0000001',1,'M1',100);
      INSERT INTO "Submission" (id,milestoneId,deliverableHash) VALUES ('s1','m1','${"a".repeat(64)}');
      INSERT INTO "ProofTrackEventRecord" (id,projectId,sequence,ecosystem,eventType,referenceType,referenceValue) VALUES ('e1','TRU-PROJ-2026-0000001',1,'ARC','X','BLOCKCHAIN_TRANSACTION_HASH','0x1');
      INSERT INTO "ProofTrackEventRecord" (id,projectId,sequence,ecosystem,eventType,referenceType,referenceValue) VALUES ('e2','TRU-PROJ-2026-0000001',2,'ARC','Y','BLOCKCHAIN_TRANSACTION_HASH','0x2');
    `);
    db.close();
  }

  return file;
}

function makeLegacyFinancialDb(name: string): string {
  const file = join(dir, `${name}.db`);
  const schema = join(dir, `${name}.prisma`);
  const legacy = oldSchema(file)
    .replace(/arcChainId\s+Int[^\n]*/, '$&\n  registerTxHash String?')
    .replace(/description\s+String\?/, '$&\n  addTxHash String?')
    .replace(/budgetUsdc\s+String/, "budgetUsdc Float")
    .replace(/amountUsdc\s+String/, "amountUsdc Float")
    .replace(/model AgentPayment \{[\s\S]*?\n\}/, `model AgentPayment {
  id              String   @id
  evaluationId    String?
  evaluation      EvaluationReport? @relation(fields: [evaluationId], references: [id], onDelete: SetNull)
  serviceName     String
  providerAccount String
  amountHbar      Float
  txId            String?
  status          String
  hashscanUrl     String?
  policyDecision  String
  settledAt       DateTime?
  @@map("AgentPayment")
}`);
  writeFileSync(schema, legacy);
  execFileSync(process.execPath, [require.resolve("prisma/build/index.js"), "db", "push", "--skip-generate", "--schema", schema], {
    stdio: "pipe",
    // Match the disposable-database setup above; Prisma 5.22 can otherwise hide the schema-engine cause.
    env: { ...process.env, RUST_LOG: "info" },
  });
  const db = new DatabaseSync(file);
  db.exec(`
    INSERT INTO "Project" (id,title,description,clientAddress,budgetUsdc,updatedAt) VALUES ('legacy-project','Legacy','d','0xc',12.345678,CURRENT_TIMESTAMP);
    INSERT INTO "Milestone" (id,projectId,milestoneIndex,title,amountUsdc) VALUES ('legacy-milestone','legacy-project',1,'M1',1.234567);
    INSERT INTO "AgentPayment" (id,serviceName,providerAccount,amountHbar,status,policyDecision) VALUES ('legacy-payment','scan','0.0.7',0.00000001,'PENDING','ALLOW');
  `);
  db.close();
  return file;
}

const sha = (f: string) => createHash("sha256").update(readFileSync(f)).digest("hex");

before(() => { dir = mkdtempSync(join(tmpdir(), "trustora-dbtest-")); });
after(() => { rmSync(dir, { recursive: true, force: true }); });

test("dry run (the default) shows the additive plan and changes nothing, not even a backup", () => {
  const file = makeOldDb("dry");
  const before = sha(file);
  const r = run({ dbPath: file, schemaPath, backupDir: join(dir, "bk-dry") });
  assert.equal(r.status, "DRY_RUN");
  assert.deepEqual([...r.plan.newTables].sort(), ["AuthNonce", "Session"]);
  assert.deepEqual([...r.plan.newColumns].sort(), ["AgentPayment.requestedByAddress", "Milestone.addTxHash", "Project.registerTxHash", "Submission.anchorTxHash", "Submission.content"]);
  assert.equal(r.plan.newIndexes.filter((i: string) => i.startsWith("unique")).length, 2);
  assert.equal(sha(file), before, "database bytes unchanged");
  assert.equal(existsSync(join(dir, "bk-dry")), false, "no backup folder created on a dry run");
});

test("apply: verified backup first, existing rows preserved, new structure present, re-run is a no-op", () => {
  const file = makeOldDb("apply");
  const original = sha(file);
  const r = run({ dbPath: file, schemaPath, apply: true, backupDir: join(dir, "bk-apply") });
  assert.equal(r.status, "APPLIED");

  // the backup is a faithful copy of the pre-update database
  assert.ok(existsSync(r.backupPath));
  assert.equal(sha(r.backupPath), original, "backup is byte-identical to the original");
  assert.equal(readdirSync(join(dir, "bk-apply")).length, 1);

  // data preserved
  for (const [table, n] of Object.entries(r.before)) assert.equal(r.after[table], n, `${table} row count unchanged`);
  assert.deepEqual([r.after.Session, r.after.AuthNonce], [0, 0], "new tables start empty");
  const db = new DatabaseSync(file, { readOnly: true });
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM "ProofTrackEventRecord"').get().n, 2);
  assert.equal(db.prepare('SELECT title FROM "Project"').get().title, "Old");
  // new structure
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((t: any) => t.name);
  assert.ok(tables.includes("Session") && tables.includes("AuthNonce"));
  const cols = (t: string) => db.prepare(`PRAGMA table_info("${t}")`).all().map((c: any) => c.name);
  assert.ok(cols("Project").includes("registerTxHash") && cols("Milestone").includes("addTxHash"));
  assert.ok(cols("Submission").includes("content") && cols("Submission").includes("anchorTxHash"));
  assert.equal(db.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
  db.close();

  // idempotent: nothing left to do, and no second backup is made
  const again = run({ dbPath: file, schemaPath, apply: true, backupDir: join(dir, "bk-apply") });
  assert.equal(again.status, "UP_TO_DATE");
  assert.equal(readdirSync(join(dir, "bk-apply")).length, 1);
});

test("the new unique constraints really are enforced after the update", () => {
  const file = makeOldDb("unique");
  run({ dbPath: file, schemaPath, apply: true, backupDir: join(dir, "bk-unique") });
  const db = new DatabaseSync(file);
  assert.throws(
    () => db.exec(`INSERT INTO "ProofTrackEventRecord" (id,projectId,sequence,ecosystem,eventType,referenceType,referenceValue) VALUES ('e3','TRU-PROJ-2026-0000001',3,'ARC','Z','BLOCKCHAIN_TRANSACTION_HASH','0x1')`),
    /UNIQUE/i, "the same tx hash cannot be recorded twice for a project",
  );
  db.close();
});

test("refuses (and changes nothing) if existing data would violate a new unique index", () => {
  const file = makeOldDb("dupes");
  const db = new DatabaseSync(file);
  db.exec(`INSERT INTO "ProofTrackEventRecord" (id,projectId,sequence,ecosystem,eventType,referenceType,referenceValue) VALUES ('dup','TRU-PROJ-2026-0000001',9,'ARC','X','BLOCKCHAIN_TRANSACTION_HASH','0x1')`);
  db.close();
  const before = sha(file);
  assert.throws(() => run({ dbPath: file, schemaPath, apply: true, backupDir: join(dir, "bk-dupes") }), (e: unknown) => e instanceof SafeUpdateError && /duplicate/i.test(e.message));
  assert.equal(sha(file), before);
  assert.equal(existsSync(join(dir, "bk-dupes")), false, "refused before any backup or write");
});

test("refuses any plan that would DROP or rebuild existing structure", () => {
  const file = makeOldDb("drop");
  const db = new DatabaseSync(file);
  db.exec(`CREATE TABLE "LegacyNotInSchema" (id TEXT PRIMARY KEY, secret TEXT); INSERT INTO "LegacyNotInSchema" VALUES ('1','keep me');`);
  db.close();
  const before = sha(file);
  assert.throws(() => run({ dbPath: file, schemaPath, apply: true, backupDir: join(dir, "bk-drop") }), (e: unknown) => e instanceof SafeUpdateError && /DROP TABLE "LegacyNotInSchema"/.test(e.message));
  assert.equal(sha(file), before, "the unknown table and its data are still there");
});

test("financial migration preserves legacy Float records as exact base-unit strings", () => {
  const file = makeLegacyFinancialDb("financial");
  const r = run({ dbPath: file, schemaPath, financialMigration: true, apply: true, backupDir: join(dir, "bk-financial") });
  assert.equal(r.status, "APPLIED");
  const db = new DatabaseSync(file, { readOnly: true });
  assert.equal(db.prepare('SELECT budgetUsdc FROM "Project"').get().budgetUsdc, "12345678");
  assert.equal(db.prepare('SELECT amountUsdc FROM "Milestone"').get().amountUsdc, "1234567");
  assert.equal(db.prepare('SELECT amountTinybars FROM "AgentPayment"').get().amountTinybars, "1");
  assert.equal(db.prepare('SELECT idempotencyKey FROM "AgentPayment"').get().idempotencyKey, "legacy:legacy-payment");
  db.close();
});

test("a missing database is not silently created", () => {
  assert.throws(() => run({ dbPath: join(dir, "nope.db"), schemaPath }), (e: unknown) => e instanceof SafeUpdateError && /npm run db:push/.test(e.message));
  assert.equal(existsSync(join(dir, "nope.db")), false);
});

test("destructive-statement detector catches drops, deletes, renames and data rewrites", () => {
  for (const sql of ['DROP TABLE "X";', 'ALTER TABLE "X" DROP COLUMN "y";', 'DELETE FROM "X";', 'ALTER TABLE "X" RENAME TO "Y";', 'UPDATE "X" SET a=1;', 'DROP INDEX "i";']) {
    assert.ok(destructiveStatements(sql).length > 0, sql);
  }
  for (const sql of ['CREATE TABLE "X" (id TEXT);', 'ALTER TABLE "X" ADD COLUMN "y" TEXT;', 'CREATE UNIQUE INDEX "i" ON "X"(a);']) {
    assert.equal(destructiveStatements(sql).length, 0, sql);
  }
  assert.deepEqual(describePlan('CREATE TABLE "A" (x TEXT);\nALTER TABLE "B" ADD COLUMN "c" TEXT;').newColumns, ["B.c"]);
});
