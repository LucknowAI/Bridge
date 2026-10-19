/**
 * Fails when a Vitest JSON report contains skipped or todo tests, so a
 * required suite cannot pass by skipping itself:
 *
 *   npx vitest run tests/integration --reporter=default --reporter=json --outputFile=vitest-report.json
 *   npx tsx tools/check-test-report.ts vitest-report.json
 */
import { readFileSync } from "node:fs";
import { isMainModule } from "../packages/db/src/is-main";

interface Report {
  numTotalTests: number;
  numPendingTests: number;
  numTodoTests: number;
  testResults: Array<{ name: string; assertionResults: Array<{ fullName: string; status: string }> }>;
}

export function skippedTests(report: Report): string[] {
  return report.testResults.flatMap((file) => file.assertionResults
    .filter((test) => test.status === "pending" || test.status === "skipped" || test.status === "todo")
    .map((test) => `${file.name.replace(/^.*[\\/]tests[\\/]/, "tests/")}: ${test.fullName}`));
}

if (isMainModule(import.meta.url)) {
  const path = process.argv[2] ?? "vitest-report.json";
  const report = JSON.parse(readFileSync(path, "utf8")) as Report;
  const skipped = skippedTests(report);
  if (report.numTotalTests === 0) {
    console.error("[test-report] no tests ran");
    process.exit(1);
  }
  if (skipped.length) {
    console.error(`[test-report] ${skipped.length} test(s) did not run:\n  ${skipped.join("\n  ")}`);
    process.exit(1);
  }
  console.info(`[test-report] all ${report.numTotalTests} tests ran`);
}
