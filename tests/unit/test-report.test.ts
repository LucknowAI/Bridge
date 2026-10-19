import { describe, expect, it } from "vitest";
import { skippedTests } from "../../tools/check-test-report";

const report = (statuses: string[]) => ({
  numTotalTests: statuses.length,
  numPendingTests: 0,
  numTodoTests: 0,
  testResults: [{ name: "/repo/tests/integration/a.test.ts", assertionResults: statuses.map((status, i) => ({ fullName: `case ${i}`, status })) }],
});

describe("test report check", () => {
  it("accepts a run where every test passed", () => {
    expect(skippedTests(report(["passed", "passed"]))).toEqual([]);
  });

  it("names each skipped, pending or todo test", () => {
    expect(skippedTests(report(["passed", "skipped", "pending", "todo"]))).toEqual([
      "tests/integration/a.test.ts: case 1",
      "tests/integration/a.test.ts: case 2",
      "tests/integration/a.test.ts: case 3",
    ]);
  });
});
