// Repeatable database security tests without Docker.
// For each test file: start a fresh in-memory PostgreSQL (PGlite), load the
// Supabase platform stub, apply every migration in order, then run the test
// file and report its TAP output.
//
// Test files:
//   supabase/tests/*.test.sql      pgTAP tests (also runnable with `supabase test db`)
//   scripts/db-checks/*.test.sql   harness-only checks; may contain
//                                  `-- @include <path>` lines, replaced by that file
//
// Usage: npm run test:db
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (...p) => readFileSync(path.join(root, ...p), 'utf8');
const list = (dir, suffix) =>
  existsSync(path.join(root, dir))
    ? readdirSync(path.join(root, dir)).filter((f) => f.endsWith(suffix)).sort().map((f) => path.join(dir, f))
    : [];

const migrations = list('supabase/migrations', '.sql');
const tests = [...list('supabase/tests', '.test.sql'), ...list('scripts/db-checks', '.test.sql')];
const stub = read('scripts/db-test-support/supabase_stub.sql');
const tap = read('scripts/db-test-support/tap_shim.sql');

// Included scripts run inside the test's transaction, so their own begin/commit are dropped.
const expandIncludes = (sql) =>
  sql.replace(/^--\s*@include\s+(\S+)\s*$/gm, (_, p) => read(p).replace(/^\s*(begin|commit);\s*$/gim, ''));

let failures = 0;
let total = 0;

for (const file of tests) {
  console.log(`\n# ${file.replace(/\\/g, '/')}`);
  const db = new PGlite();
  try {
    await db.exec(stub);
    for (const m of migrations) {
      try {
        await db.exec(read(m));
      } catch (e) {
        throw new Error(`migration ${path.basename(m)} failed: ${e.message}`);
      }
    }
    await db.exec(tap);

    const sql = expandIncludes(read(file)).replace(/create extension if not exists pgtap[^;]*;/i, '');
    const results = await db.exec(sql);
    for (const result of results) {
      for (const row of result.rows) {
        for (const value of Object.values(row)) {
          if (typeof value !== 'string' || !/^(ok|not ok|#|1\.\.)/.test(value)) continue;
          console.log(value);
          if (value.startsWith('ok')) total++;
          if (value.startsWith('not ok')) {
            total++;
            failures++;
          }
          if (value.startsWith('# Looks like you planned')) failures++;
        }
      }
    }
  } catch (e) {
    failures++;
    console.log(`not ok - ${file} crashed: ${e.message}`);
  } finally {
    await db.close();
  }
}

console.log(`\n# ${total - Math.min(failures, total)} passed, ${failures} failed, ${tests.length} file(s)`);
process.exit(failures ? 1 : 0);
