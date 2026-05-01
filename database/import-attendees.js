/**
 * import-attendees.js
 * Run once to seed registered_attendees from your Excel file.
 *
 * Usage:
 *   npm install xlsx @supabase/supabase-js dotenv
 *   node import-attendees.js attendees.xlsx
 *
 * Excel columns expected (case-insensitive, flexible naming):
 *   Name | Email | Phone Number | About Me | Designation | Domain
 *   Which describes you best right now | Years of Experience
 *   What most impressive thing you have built with AI
 */

import XLSX from "xlsx";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: ".env.local" });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY  // ← SERVICE key (not anon) for admin insert
);

function normalizePhone(raw) {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, "");
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 12 && digits.startsWith("91")) return `+${digits}`;
  if (digits.startsWith("+")) return raw.trim();
  return `+${digits}`;
}

// Grab a field by trying multiple possible column name variants
function pick(r, ...keys) {
  for (const k of keys) {
    const val = r[k.toLowerCase().trim()];
    if (val !== undefined && val !== "") return String(val).trim();
  }
  return null;
}

async function main() {
  const filePath = process.argv[2];
  if (!filePath) { console.error("Usage: node import-attendees.js attendees.xlsx"); process.exit(1); }

  const workbook = XLSX.readFile(path.resolve(filePath));
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });

  console.log(`Found ${rows.length} rows in Excel`);

  const records = rows.map(row => {
    // Normalise all column keys to lowercase for flexible matching
    const r = Object.fromEntries(
      Object.entries(row).map(([k, v]) => [k.toLowerCase().trim(), v])
    );

    const yearsRaw = pick(r, "years of experience", "years_of_experience", "experience", "yoe");
    const yearsNum = yearsRaw ? parseInt(yearsRaw, 10) : null;

    return {
      name:                  pick(r, "name", "full name")                                     || null,
      email:                 pick(r, "email", "email address", "mail")?.toLowerCase()         || null,
      phone:                 normalizePhone(pick(r, "phone number", "phone", "mobile", "contact")),
      about_me:              pick(r, "about me", "about", "bio", "about_me")                  || null,
      designation:           pick(r, "designation", "title", "job title", "role")             || null,
      domain:                pick(r, "domain", "primary domain", "field")                     || null,
      self_description:      pick(r, "which describes you best right now", "self description",
                                   "describes you", "i am", "self_description")               || null,
      years_of_experience:   Number.isFinite(yearsNum) ? yearsNum                             : null,
      most_impressive_build: pick(r, "what most impressive thing you have built with ai",
                                   "most impressive build", "impressive build",
                                   "built with ai", "most_impressive_build")                  || null,
    };
  }).filter(r => r.email || r.phone); // must have at least one login identifier

  console.log(`Importing ${records.length} valid records…`);

  // Deduplicate by email first, then by phone to avoid unique constraint errors
  const seenEmails = new Set();
  const seenPhones = new Set();
  const deduped = records.filter(r => {
    if (r.email && seenEmails.has(r.email)) return false;
    if (r.phone && seenPhones.has(r.phone)) return false;
    if (r.email) seenEmails.add(r.email);
    if (r.phone) seenPhones.add(r.phone);
    return true;
  });

  console.log(`After dedup: ${deduped.length} unique records`);

  // Upsert in batches of 100
  for (let i = 0; i < deduped.length; i += 100) {
    const batch = deduped.slice(i, i + 100);
    const { error } = await supabase
      .from("registered_attendees")
      .upsert(batch, { onConflict: "email", ignoreDuplicates: false });

    if (error) {
      console.error(`Batch ${Math.floor(i / 100) + 1} error:`, error.message);
    } else {
      console.log(`✓ Batch ${Math.floor(i / 100) + 1} imported (${batch.length} rows)`);
    }
  }

  console.log("Done!");
}

main().catch(console.error);