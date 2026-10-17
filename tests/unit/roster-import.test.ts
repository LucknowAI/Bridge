import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { parseRosterWorkbook } from "@/src/lib/excel-importer";
import { ValidationError } from "@/src/domain/shared/validation";

function workbook(rows: Array<Record<string, unknown>>): ArrayBuffer {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(rows), "Roster");
  return XLSX.write(book, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
}

function fileError(action: () => unknown): ValidationError {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).field).toBe("file");
    return error as ValidationError;
  }
  throw new Error("expected a ValidationError");
}

describe("parseRosterWorkbook", () => {
  it("imports valid rows and counts the ones it skips", () => {
    const { records, skipped } = parseRosterWorkbook(workbook([
      { Name: "Asha", Email: "Asha@Example.com", Phone: "9876543210" },
      { Name: "No mail", Email: "" },
      { Name: "Bad mail", Email: "not-an-email" },
      { Name: "Same mail", Email: "asha@example.com" },
      { Name: "Same phone", Email: "other@example.com", Phone: "+91 98765 43210" },
      { Name: "Ravi", Email: "ravi@example.com" },
    ]));
    expect(records.map((record) => record.email)).toEqual(["asha@example.com", "ravi@example.com"]);
    expect(skipped).toBe(4);
  });

  it("rejects a file that is not a workbook", () => {
    expect(fileError(() => parseRosterWorkbook(new TextEncoder().encode("\u0000\u0001 not excel").buffer as ArrayBuffer)).message)
      .toMatch(/could not be read|no rows/i);
  });

  it("rejects a roster without any usable e-mail", () => {
    expect(fileError(() => parseRosterWorkbook(workbook([{ Name: "Nobody", Email: "nope" }]))).message).toMatch(/No rows/);
  });
});
