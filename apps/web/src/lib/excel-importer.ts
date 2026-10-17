import * as XLSX from "xlsx";
import { attendees } from "@match-maker/db";
import type { RosterAttendeeInput } from "../application/ports/event-repository";
import { LIMITS, ValidationError } from "../domain/shared/validation";

const COLUMN_NAMES = {
  name: ["name", "full name"],
  email: ["email", "email address", "mail"],
  phone: ["phone number", "phone", "mobile", "contact"],
  about_me: ["about me", "about", "bio", "about_me"],
  designation: ["designation", "title", "job title", "role"],
  domain: ["domain", "primary domain", "field"],
  self_description: ["which describes you best right now", "self description", "describes you", "i am", "self_description"],
  years_of_experience: ["years of experience", "years_of_experience", "experience", "yoe"],
  most_impressive_build: ["what most impressive thing you have built with ai", "most impressive build", "impressive build", "built with ai", "most_impressive_build"],
} as const;

export interface RosterParseResult {
  records: RosterAttendeeInput[];
  /** Rows left out: missing/invalid e-mail, or an e-mail/phone already seen in the file. */
  skipped: number;
}

export function parseRosterWorkbook(bytes: ArrayBuffer): RosterParseResult {
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(Buffer.from(bytes), { type: "buffer" });
  } catch {
    throw new ValidationError("file", "This file could not be read. Upload an .xlsx or .xls workbook.");
  }
  const firstSheet = workbook.SheetNames[0];
  if (!firstSheet) throw new ValidationError("file", "The workbook has no sheets");
  const sheet = workbook.Sheets[firstSheet];
  const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
  if (rawRows.length > LIMITS.rosterRows) {
    throw new ValidationError("file", `Roster files are limited to ${LIMITS.rosterRows.toLocaleString("en")} rows`);
  }

  const seenEmails = new Set<string>();
  const seenPhones = new Set<string>();
  const result: RosterAttendeeInput[] = [];
  for (const raw of rawRows) {
    const row = Object.fromEntries(Object.entries(raw).map(([key, value]) => [normalizeHeader(key), value]));
    const email = pick(row, COLUMN_NAMES.email)?.toLowerCase();
    const rawPhone = pick(row, COLUMN_NAMES.phone);
    const phone = rawPhone ? attendees.normalizePhone(rawPhone) : null;
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || seenEmails.has(email) || (phone && seenPhones.has(phone))) continue;
    const rawYears = pick(row, COLUMN_NAMES.years_of_experience);
    const years = rawYears ? Number.parseInt(rawYears, 10) : NaN;
    result.push({
      name: pick(row, COLUMN_NAMES.name),
      email,
      phone,
      about_me: pick(row, COLUMN_NAMES.about_me),
      designation: pick(row, COLUMN_NAMES.designation),
      domain: pick(row, COLUMN_NAMES.domain),
      self_description: pick(row, COLUMN_NAMES.self_description),
      years_of_experience: Number.isInteger(years) && years >= 0 && years <= 80 ? years : null,
      most_impressive_build: pick(row, COLUMN_NAMES.most_impressive_build),
    });
    seenEmails.add(email);
    if (phone) seenPhones.add(phone);
  }
  if (!result.length) throw new ValidationError("file", "No rows with a valid e-mail address were found. Check the e-mail column.");
  return { records: result, skipped: rawRows.length - result.length };
}

function normalizeHeader(value: string): string {
  return value.toLowerCase().trim().replace(/\s+/g, " ");
}

function pick(row: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = row[normalizeHeader(key)];
    if (value === undefined || value === null || value === "") continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return null;
}
