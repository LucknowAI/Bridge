/**
 * Bulk-import attendees from an Excel sheet.
 *
 * Replaces the Supabase-based database/import-attendees.js — same column
 * matching and dedup rules, now writing through the shared Postgres pool.
 *
 * Usage:
 *   npm run db:import -- attendees.xlsx
 *
 * Excel columns expected (case-insensitive, flexible naming):
 *   Name | Email | Phone Number | About Me | Designation | Domain
 *   Which describes you best right now | Years of Experience
 *   What most impressive thing you have built with AI
 */
import "dotenv/config";
import path from "node:path";
import XLSX from "xlsx";
import { closePool } from "@match-maker/db";
import { attendees, events } from "@match-maker/db";

interface AttendeeRecord {
  name: string | null;
  email: string | null;
  phone: string | null;
  about_me: string | null;
  designation: string | null;
  domain: string | null;
  self_description: string | null;
  years_of_experience: number | null;
  most_impressive_build: string | null;
}

/** Grab a field by trying multiple possible column name variants. */
function pick(r: Record<string, unknown>, ...keys: string[]): string | null {
  for (const k of keys) {
    const val = r[k.toLowerCase().trim()];
    if (val !== undefined && val !== "") return String(val).trim();
  }
  return null;
}

async function main(): Promise<void> {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error("Usage: npm run db:import -- attendees.xlsx");
    process.exit(1);
  }
  const eventSlug = process.argv[3] || process.env.DEFAULT_EVENT_SLUG || "demo";
  const attachToEvent = eventSlug !== "--no-event";

  const workbook = XLSX.readFile(path.resolve(filePath));
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error("Workbook has no sheets");

  const sheet = workbook.Sheets[sheetName];
  const rows: Record<string, unknown>[] = XLSX.utils.sheet_to_json(sheet!, {
    defval: "",
  });

  console.log(`Found ${rows.length} rows in Excel`);

  const records: AttendeeRecord[] = rows
    .map((row): AttendeeRecord => {
      // Normalise all column keys to lowercase for flexible matching
      const r = Object.fromEntries(
        Object.entries(row).map(([k, v]) => [k.toLowerCase().trim(), v])
      );

      const yearsRaw = pick(r, "years of experience", "years_of_experience", "experience", "yoe");
      const yearsNum = yearsRaw ? Number.parseInt(yearsRaw, 10) : null;
      const phoneRaw = pick(r, "phone number", "phone", "mobile", "contact");

      return {
        name: pick(r, "name", "full name"),
        email: pick(r, "email", "email address", "mail")?.toLowerCase() ?? null,
        phone: phoneRaw ? attendees.normalizePhone(phoneRaw) : null,
        about_me: pick(r, "about me", "about", "bio", "about_me"),
        designation: pick(r, "designation", "title", "job title", "role"),
        domain: pick(r, "domain", "primary domain", "field"),
        self_description: pick(
          r,
          "which describes you best right now",
          "self description",
          "describes you",
          "i am",
          "self_description"
        ),
        years_of_experience: Number.isFinite(yearsNum) ? yearsNum : null,
        most_impressive_build: pick(
          r,
          "what most impressive thing you have built with ai",
          "most impressive build",
          "impressive build",
          "built with ai",
          "most_impressive_build"
        ),
      };
    })
    // An e-mail is now mandatory: it is the login identifier and the upsert key.
    .filter((r) => r.email);

  console.log(`Importing ${records.length} valid records…`);

  // Deduplicate by email first, then by phone to avoid unique constraint errors
  const seenEmails = new Set<string>();
  const seenPhones = new Set<string>();
  const deduped = records.filter((r) => {
    if (r.email && seenEmails.has(r.email)) return false;
    if (r.phone && seenPhones.has(r.phone)) return false;
    if (r.email) seenEmails.add(r.email);
    if (r.phone) seenPhones.add(r.phone);
    return true;
  });

  console.log(`After dedup: ${deduped.length} unique records`);

  const event = attachToEvent ? await events.findByEventSlug(eventSlug) : null;
  if (attachToEvent && !event) throw new Error(`Event "${eventSlug}" does not exist. Create it before importing the roster, or use --no-event to import identities first.`);

  let total = 0;
  const failedBatches: number[] = [];
  for (let i = 0; i < deduped.length; i += 100) {
    const batch = deduped.slice(i, i + 100);
    try {
      total += await attendees.upsertMany(batch);
      console.log(`✓ Batch ${Math.floor(i / 100) + 1} imported (${batch.length} rows)`);
    } catch (err) {
      failedBatches.push(Math.floor(i / 100) + 1);
      console.error(
        `Batch ${Math.floor(i / 100) + 1} error:`,
        err instanceof Error ? err.message : err
      );
    }
  }

  if (failedBatches.length) throw new Error(`Roster import failed for batch(es): ${failedBatches.join(", ")}`);

  let attached = 0;
  if (event) {
    const imported = await attendees.findIdsByEmails(deduped.map((record) => record.email!).filter(Boolean));
    attached = await events.attachRoster(event.id, imported.map((row) => row.id));
  }

  console.log(event
    ? `Done — ${total} attendee row(s) written; ${attached} added to event "${event.name}".`
    : `Done — ${total} attendee row(s) written to the shared attendee directory.`);
}

main()
  .then(() => closePool())
  .then(() => process.exit(0))
  .catch(async (err) => {
    console.error("Import failed:", err);
    await closePool().catch(() => {});
    process.exit(1);
  });
