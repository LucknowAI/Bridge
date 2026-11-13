import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import os from "os";
import { attendees, matches } from "@match-maker/db";
import { getSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CACHE_FILE = path.join(os.tmpdir(), ".gemini-cache.json");
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

// ── In-process lock ───────────────────────────────────────────
// If multiple users trigger /api/match simultaneously when the cache
// is cold, only ONE Gemini file upload is fired. All other concurrent
// requests wait for and reuse the same Promise — no duplicate uploads.
//
// Note: the cache is per-task. With ECS autoscaling each task warms its
// own copy, which is fine — the TTL bounds it to one upload per task per hour.
let uploadInFlight = null;

// ── Gemini File API: upload attendees list once, reuse URI ────
async function getAttendeesFileUri(candidates) {
  // 1. Fast path — valid cache on disk
  if (fs.existsSync(CACHE_FILE)) {
    try {
      const cache = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"));
      if (Date.now() - cache.uploadedAt < CACHE_TTL_MS && cache.fileUri) {
        console.log("Reusing cached Gemini file URI:", cache.fileUri);
        return cache.fileUri;
      }
    } catch {}
  }

  // 2. If another request is already uploading, wait for it
  if (uploadInFlight) {
    console.log("Upload in-flight — awaiting shared promise");
    return uploadInFlight;
  }

  // 3. This request wins the race — start the upload and share the promise
  uploadInFlight = _doUpload(candidates).finally(() => {
    uploadInFlight = null;
  });

  return uploadInFlight;
}

async function _doUpload(candidates) {
  // Keep each line compact — truncate long free-text fields
  const content = candidates
    .map((a, i) => {
      const about = (a.about_me || "").slice(0, 120);
      const self = (a.self_description || "").slice(0, 80);
      const build = (a.most_impressive_build || "").slice(0, 80);
      return `${i + 1}. ID:${a.id} | ${a.name || "?"} | ${a.domain || "N/A"} | ${a.designation || "N/A"} | ${a.years_of_experience ?? "N/A"}y | About:${about} | Self:${self} | Build:${build}`;
    })
    .join("\n");

  const blob = Buffer.from(content, "utf8");

  const initRes = await fetch(
    `https://generativelanguage.googleapis.com/upload/v1beta/files?key=${process.env.GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: {
        "X-Goog-Upload-Protocol": "resumable",
        "X-Goog-Upload-Command": "start",
        "X-Goog-Upload-Header-Content-Length": blob.length,
        "X-Goog-Upload-Header-Content-Type": "text/plain",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ file: { display_name: "attendees-list" } }),
    }
  );

  if (!initRes.ok) {
    const t = await initRes.text();
    throw new Error(`File upload init failed: ${t}`);
  }

  const uploadUrl = initRes.headers.get("x-goog-upload-url");

  const uploadRes = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      "X-Goog-Upload-Command": "upload, finalize",
      "X-Goog-Upload-Offset": "0",
      "Content-Type": "text/plain",
    },
    body: blob,
  });

  if (!uploadRes.ok) {
    const t = await uploadRes.text();
    throw new Error(`File upload failed: ${t}`);
  }

  const fileData = await uploadRes.json();
  const fileUri = fileData?.file?.uri;
  if (!fileUri) throw new Error("No file URI returned from Gemini");

  console.log("Uploaded attendees to Gemini, URI:", fileUri);
  fs.writeFileSync(CACHE_FILE, JSON.stringify({ fileUri, uploadedAt: Date.now() }));
  return fileUri;
}

// ── Salvage complete JSON objects from a truncated array string ──
// Returns all fully-closed { } objects even if the outer array is cut off.
function recoverPartialJsonArray(raw) {
  const text = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();

  // Try straight parse first
  try {
    return JSON.parse(text);
  } catch {}

  // Walk character-by-character to pull out each complete {...} block
  const results = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escape = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (escape) { escape = false; continue; }
    if (ch === "\\" && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;

    if (ch === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0 && start !== -1) {
        try { results.push(JSON.parse(text.slice(start, i + 1))); } catch {}
        start = -1;
      }
    }
  }

  return results.length ? results : null;
}

export async function POST(req) {
  try {
    // Matching exposes other attendees' profiles, so it is signed-in only.
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { userInterests } = await req.json();

    if (!Array.isArray(userInterests) || userInterests.length === 0) {
      return NextResponse.json({ error: "Select at least one interest" }, { status: 400 });
    }

    // Identity and profile come from the session, never from the request body —
    // otherwise a caller could match as somebody else.
    const profile = await attendees.findById(session.attendeeId);
    if (!profile) {
      return NextResponse.json({ error: "Profile not found" }, { status: 404 });
    }

    const userName = profile.name || session.name || "";
    const userDomain = profile.domain || "";

    // The requester is excluded in SQL, so their row never reaches this process.
    const candidates = await attendees.listMatchCandidates(session.attendeeId);

    if (!candidates.length) {
      return NextResponse.json({ error: "No candidates found" }, { status: 404 });
    }

    // Upload attendees to Gemini File API (cached + race-safe)
    const fileUri = await getAttendeesFileUri(candidates);

    // Prompt: ask Gemini for only IDs + compact fields.
    // about_me / most_impressive_build are pulled from DB after parsing — not
    // echoed back — so the JSON output stays tiny regardless of attendee count.
    const prompt = `You are a networking matchmaker at "AI Community Lucknow" (aicommunity.lucknow.dev).

The attached file contains the full attendee list (one per line, pipe-separated).

User looking for matches:
- Name: ${userName}
- Domain: ${userDomain}
- Interests: ${userInterests.join(", ")}
- Designation: ${profile.designation || "N/A"}
- Experience: ${profile.years_of_experience ?? "Unknown"} years
- About: ${profile.about_me ? String(profile.about_me).slice(0, 120) : "N/A"}

Task: Select TOP 10 best matches from the attendee list based on domain alignment, complementary skills, shared interests, and collaboration potential. Sort from MOST to LEAST experienced (years_of_experience field).

IMPORTANT: Reply ONLY with a raw JSON array — no markdown, no prose, no extra text.
Keep every string value SHORT. The "match_reason" must be at most 15 words.
Schema (exactly 7 fields per object):
[{"id":"<id>","name":"<name>","designation":"<designation>","domain":"<domain>","years_of_experience":<number|null>,"score":<0-99>,"match_reason":"<max 15 words>"}]`;

    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{
            parts: [
              { file_data: { mime_type: "text/plain", file_uri: fileUri } },
              { text: prompt },
            ],
          }],
          // maxOutputTokens is a ceiling, NOT a cost. Gemini stops when done
          // (~600 tokens for 10 objects). High ceiling just prevents truncation.
          generationConfig: { temperature: 0.4, maxOutputTokens: 65536 },
        }),
      }
    );

    // Handle Gemini rate-limit gracefully (many concurrent users on free tier)
    if (geminiRes.status === 429) {
      console.warn("Gemini 429 — rate limit hit");
      return NextResponse.json(
        { error: "The AI is busy right now. Please wait 10 seconds and try again." },
        { status: 429 }
      );
    }

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      if (errText.includes("not found") || errText.includes("INVALID_ARGUMENT")) {
        if (fs.existsSync(CACHE_FILE)) fs.unlinkSync(CACHE_FILE);
        return NextResponse.json({ error: "Attendee cache expired, please try again" }, { status: 503 });
      }
      let detail = errText;
      try { detail = JSON.parse(errText)?.error?.message || errText; } catch {}
      return NextResponse.json({ error: `Gemini API failed: ${detail}` }, { status: 502 });
    }

    const geminiData = await geminiRes.json();
    const finishReason = geminiData?.candidates?.[0]?.finishReason;
    console.log("Finish reason:", finishReason);
    const rawText = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text || "";

    // Partial-JSON recovery — salvage whatever complete objects exist
    let parsed = recoverPartialJsonArray(rawText);

    if (!parsed || !parsed.length) {
      console.error("Parse failed entirely. Raw:", rawText.slice(0, 800));
      return NextResponse.json(
        { error: "AI returned an unreadable response. Please try again." },
        { status: 502 }
      );
    }

    if (finishReason === "MAX_TOKENS") {
      console.warn(`MAX_TOKENS hit — recovered ${parsed.length} of 10 matches from partial response.`);
    }

    // Enrich with full DB data (about_me, most_impressive_build, avatar initials).
    // Drop anything Gemini invented that is not a real candidate — the model
    // must not be able to introduce identities of its own.
    const byId = new Map(candidates.map((c) => [String(c.id), c]));
    const enriched = parsed
      .map((m) => {
        const full =
          byId.get(String(m.id)) || candidates.find((a) => a.name === m.name);
        if (!full) return null;

        const nameParts = (full.name || m.name || "??").trim().split(" ");
        const avatar =
          nameParts.length >= 2
            ? nameParts[0][0].toUpperCase() +
              nameParts[nameParts.length - 1][0].toUpperCase()
            : nameParts[0].slice(0, 2).toUpperCase();

        return {
          id: full.id,
          name: full.name || m.name,
          avatar,
          designation: full.designation ?? m.designation ?? null,
          domain: full.domain ?? m.domain ?? null,
          years_of_experience: full.years_of_experience ?? m.years_of_experience ?? null,
          // Always pull long text from DB — never from Gemini's echoed output
          about_me: full.about_me || null,
          most_impressive_build: full.most_impressive_build || null,
          score: typeof m.score === "number" ? m.score : null,
          match_reason: typeof m.match_reason === "string" ? m.match_reason : null,
        };
      })
      .filter(Boolean);

    if (!enriched.length) {
      return NextResponse.json(
        { error: "AI returned no usable matches. Please try again." },
        { status: 502 }
      );
    }

    // ── Guarantee sort order: most → least experienced, nulls last ──
    // Gemini is asked to sort but LLMs aren't deterministic — always enforce
    // the correct order server-side so index 0 is definitively the most senior.
    enriched.sort((a, b) => {
      const ay = a.years_of_experience ?? -1;
      const by = b.years_of_experience ?? -1;
      return by - ay;
    });

    // Persist the run. Best-effort: a bookkeeping failure must not cost the
    // user the results they just waited for.
    try {
      await matches.recordMatches(
        session.sub,
        enriched.map((m) => ({
          attendeeId: m.id,
          score: m.score,
          reason: m.match_reason,
        }))
      );
    } catch (err) {
      console.error("[match] could not record match session:", err);
    }

    return NextResponse.json({ matches: enriched });
  } catch (err) {
    console.error("Match API error:", err);
    return NextResponse.json({ error: err.message || "Internal server error" }, { status: 500 });
  }
}
