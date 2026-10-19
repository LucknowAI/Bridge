/**
 * Release gate for migrations, so a rollback to the previous image stays
 * safe: migrations run before the new code, and the old code must keep
 * working on the migrated schema.
 *
 *   npx tsx tools/check-migrations.ts <base git ref>
 *
 * - A released migration (present at the base ref) never changes.
 * - New migrations only expand the schema. Dropping or renaming a table or
 *   column, changing a column type or truncating breaks the previous image;
 *   such a statement needs `-- contract: <why the previous release no longer
 *   uses it>` on the same line, and belongs in a release after the code
 *   stopped using it.
 * - Migration numbers are unique.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { isMainModule } from "../packages/db/src/is-main";

const DIR = "packages/db/migrations";
const BREAKING = [
  /\bdrop\s+table\b/i,
  /\bdrop\s+column\b/i,
  /\brename\s+(column\s+)?\w+\s+to\b/i,
  /\brename\s+to\b/i,
  /\balter\s+column\s+\w+\s+(set\s+data\s+)?type\b/i,
  /\btruncate\b/i,
  /\bdrop\s+schema\b/i,
];

const normalize = (sql: string) => sql.replace(/\r\n/g, "\n");

export function migrationProblems(base: Map<string, string>, head: Map<string, string>): string[] {
  const problems: string[] = [];
  for (const [name, sql] of base) {
    if (!head.has(name)) problems.push(`${name} was released and must not be deleted`);
    else if (normalize(head.get(name)!) !== normalize(sql)) problems.push(`${name} was released and must not change; add a new migration instead`);
  }
  for (const [name, sql] of head) {
    if (base.has(name)) continue;
    normalize(sql).split("\n").forEach((line, index) => {
      const code = line.replace(/--.*$/, "");
      if (BREAKING.some((pattern) => pattern.test(code)) && !/--\s*contract:\s*\S/.test(line)) {
        problems.push(`${name}:${index + 1} would break the previous release: "${line.trim()}" (mark a deliberate contract step with "-- contract: <reason>")`);
      }
    });
  }
  const numbers = new Map<string, string>();
  for (const name of head.keys()) {
    const number = name.split("_")[0];
    if (numbers.has(number)) problems.push(`${name} reuses number ${number} of ${numbers.get(number)}`);
    numbers.set(number, name);
  }
  return problems;
}

function filesAt(ref: string): Map<string, string> {
  execFileSync("git", ["rev-parse", "--verify", `${ref}^{commit}`], { stdio: "ignore" });
  // The base may predate the migrations folder: then nothing was released.
  const listing = execFileSync("git", ["ls-tree", "-r", "--name-only", ref, "--", DIR], { encoding: "utf8" });
  const names = listing.split("\n").filter((path) => path.endsWith(".sql")).map((path) => path.slice(DIR.length + 1));
  return new Map(names.map((name) => [name, execFileSync("git", ["show", `${ref}:${DIR}/${name}`], { encoding: "utf8" })]));
}

if (isMainModule(import.meta.url)) {
  const ref = process.argv[2];
  const head = new Map(readdirSync(DIR).filter((name) => name.endsWith(".sql")).map((name) => [name, readFileSync(`${DIR}/${name}`, "utf8")]));
  let base = new Map<string, string>();
  if (!ref || /^0+$/.test(ref)) {
    console.warn("[migrations] no base ref; checking new-migration rules for every file");
  } else {
    base = filesAt(ref);
  }
  const problems = migrationProblems(base, head);
  for (const problem of problems) console.error(`[migrations] ${problem}`);
  console.info(problems.length ? `[migrations] ${problems.length} problem(s)` : `[migrations] ${head.size} migrations; ${head.size - base.size} new, all safe to roll back from`);
  process.exitCode = problems.length ? 1 : 0;
}
