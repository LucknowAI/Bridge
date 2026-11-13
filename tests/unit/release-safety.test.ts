import { describe, expect, it } from "vitest";
import { migrationProblems } from "../../tools/check-migrations";
import { compareState, type DatabaseState } from "../../tools/verify-database";

const files = (entries: Record<string, string>) => new Map(Object.entries(entries));

describe("migration release gate", () => {
  const released = files({ "0001_init.sql": "create table a (id int);\n" });

  it("accepts expand-only migrations", () => {
    expect(migrationProblems(released, files({
      ...Object.fromEntries(released),
      "0002_more.sql": "alter table a add column b text;\ncreate index if not exists a_b on a (b);\ndrop index if exists old_idx;\n",
    }))).toEqual([]);
  });

  it("refuses changes to a released migration, even when only line endings stay the same", () => {
    expect(migrationProblems(released, files({ "0001_init.sql": "create table a (id int);\r\n" }))).toEqual([]);
    expect(migrationProblems(released, files({ "0001_init.sql": "create table a (id bigint);\n" }))[0]).toMatch(/must not change/);
    expect(migrationProblems(released, files({}))[0]).toMatch(/must not be deleted/);
  });

  it("names each statement that would break the previous image", () => {
    const problems = migrationProblems(released, files({
      ...Object.fromEntries(released),
      "0002_risky.sql": [
        "alter table a drop column b;",
        "alter table a rename column c to d;",
        "alter table a alter column e type bigint;",
        "drop table old;",
        "-- drop table only mentioned in a comment",
        "alter table a drop column f; -- contract: unused since release 41",
      ].join("\n"),
    }));
    expect(problems.map((problem) => problem.split(" ")[0])).toEqual(["0002_risky.sql:1", "0002_risky.sql:2", "0002_risky.sql:3", "0002_risky.sql:4"]);
  });

  it("refuses two migrations with the same number", () => {
    expect(migrationProblems(new Map(), files({ "0002_a.sql": "", "0002_b.sql": "" }))).toEqual(["0002_b.sql reuses number 0002 of 0002_a.sql"]);
  });
});

describe("database verification", () => {
  const state = (overrides: Partial<DatabaseState> = {}): DatabaseState => ({
    vector: true,
    applied: files({ "0001_init.sql": "sum1" }),
    counts: { events: 3, organizations: 1 },
    ...overrides,
  });
  const expected = new Map([["0001_init.sql", ["sum1", "sum1-crlf"]]]);

  it("accepts a complete database", () => {
    expect(compareState(state(), expected)).toEqual({ problems: [], differences: [] });
  });

  it("reports what makes a database unusable", () => {
    const { problems } = compareState(state({ vector: false, applied: files({ "0001_init.sql": "other" }), counts: { events: null } }), new Map([...expected, ["0002_next.sql", ["sum2"]]]));
    expect(problems).toEqual([
      "the pgvector extension is missing",
      "migration 0001_init.sql was applied from a different file",
      "migration 0002_next.sql is not applied",
      "table events is missing",
    ]);
  });

  it("lists row count differences against a source", () => {
    expect(compareState(state(), expected, state({ counts: { events: 4, organizations: 1 } })).differences).toEqual(["events: 3 here, 4 in the source"]);
  });
});
