/**
 * Exercises the login-challenge lifecycle against a real Postgres.
 *
 * Skipped automatically when DATABASE_URL is unset, so `npm test` stays green
 * without Docker. Run the full set with the compose stack up:
 *   npm run docker:up && npm test
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { query, closePool, attendees, loginChallenges } from "@match-maker/db";
import { issueChallenge, verifyCode, verifyToken, RateLimitError } from "@match-maker/auth";
import { migrate } from "../../packages/db/src/migrate";

const hasDatabase = Boolean(process.env.DATABASE_URL);
const describeDb = hasDatabase ? describe : describe.skip;

const EMAIL = "integration-test@example.com";
const QUERY_EMAIL = "integration-query@example.com";

// Shared by both suites below, so the pool closes once, after both finish.
afterAll(() => closePool());

describeDb("login challenge lifecycle", () => {
  let attendeeId: string;

  beforeAll(async () => {
    process.env.SESSION_SECRET ||= "integration-test-secret-long-enough-value";
    await migrate();

    await attendees.upsertMany([
      { name: "Integration Test", email: EMAIL, phone: "+919999900001" },
    ]);
    const attendee = await attendees.findByEmail(EMAIL);
    attendeeId = attendee!.id;
  });

  afterAll(async () => {
    await query(`delete from login_challenges where email = $1`, [EMAIL]);
    await query(`delete from registered_attendees where email = $1`, [EMAIL]);
  });

  async function freshChallenge() {
    await query(`delete from login_challenges where email = $1`, [EMAIL]);
    return issueChallenge({ email: EMAIL, attendeeId, ipAddress: "127.0.0.1" });
  }

  it("accepts the correct code exactly once", async () => {
    const { code } = await freshChallenge();

    const first = await verifyCode(EMAIL, code);
    expect(first).toMatchObject({ ok: true, email: EMAIL, attendeeId });

    // Replaying a consumed code must fail.
    const second = await verifyCode(EMAIL, code);
    expect(second.ok).toBe(false);
  });

  it("accepts the magic-link token", async () => {
    const { token } = await freshChallenge();
    expect(await verifyToken(token)).toMatchObject({ ok: true, email: EMAIL });
  });

  it("lets the code and the link consume the same challenge only once", async () => {
    const { code, token } = await freshChallenge();

    expect((await verifyToken(token)).ok).toBe(true);
    // The code from the very same e-mail is now spent too.
    expect((await verifyCode(EMAIL, code)).ok).toBe(false);
  });

  it("rejects a wrong code and counts the attempt", async () => {
    const { code } = await freshChallenge();
    const wrong = code === "000000" ? "111111" : "000000";

    const result = await verifyCode(EMAIL, wrong);
    expect(result).toMatchObject({ ok: false, reason: "invalid_code" });

    // The real code still works — one mistake must not burn the challenge.
    expect((await verifyCode(EMAIL, code)).ok).toBe(true);
  });

  it("burns the challenge after too many wrong attempts", async () => {
    const { code } = await freshChallenge();
    const wrong = code === "000000" ? "111111" : "000000";

    for (let i = 0; i < loginChallenges.MAX_CODE_ATTEMPTS; i++) {
      await verifyCode(EMAIL, wrong);
    }

    // Even the correct code is now refused.
    expect((await verifyCode(EMAIL, code)).ok).toBe(false);
  });

  it("invalidates the previous code when a new one is requested", async () => {
    const first = await freshChallenge();
    const second = await issueChallenge({
      email: EMAIL,
      attendeeId,
      ipAddress: null,
    });

    expect((await verifyCode(EMAIL, first.code)).ok).toBe(false);
    expect((await verifyCode(EMAIL, second.code)).ok).toBe(true);
  });

  it("rejects an expired challenge", async () => {
    const { code } = await freshChallenge();
    await query(
      `update login_challenges set expires_at = now() - interval '1 minute'
        where email = $1`,
      [EMAIL]
    );
    expect(await verifyCode(EMAIL, code)).toMatchObject({
      ok: false,
      reason: "not_found",
    });
  });

  it("stores only hashes, never the code or token", async () => {
    const { code, token } = await freshChallenge();
    const { rows } = await query<{ code_hash: string; token_hash: string }>(
      `select code_hash, token_hash from login_challenges where email = $1`,
      [EMAIL]
    );
    expect(rows[0]!.code_hash).not.toBe(code);
    expect(rows[0]!.token_hash).not.toBe(token);
    expect(rows[0]!.code_hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rate-limits repeated requests for the same address", async () => {
    await query(`delete from login_challenges where email = $1`, [EMAIL]);
    process.env.OTP_MAX_PER_WINDOW = "3";

    for (let i = 0; i < 3; i++) {
      await issueChallenge({ email: EMAIL, attendeeId, ipAddress: null });
    }

    await expect(
      issueChallenge({ email: EMAIL, attendeeId, ipAddress: null })
    ).rejects.toBeInstanceOf(RateLimitError);

    delete process.env.OTP_MAX_PER_WINDOW;
  });
});

// Owns its attendee: the suite above deletes EMAIL in its afterAll.
describeDb("attendee queries", () => {
  let attendeeId: string;

  beforeAll(async () => {
    await migrate();
    await attendees.upsertMany([
      { name: "Integration Query", email: QUERY_EMAIL, phone: "+919999900002" },
    ]);
    attendeeId = (await attendees.findByEmail(QUERY_EMAIL))!.id;
  });

  afterAll(async () => {
    await query(`delete from registered_attendees where email = $1`, [QUERY_EMAIL]);
  });

  it("excludes the requester from match candidates", async () => {
    const candidates = await attendees.listMatchCandidates(attendeeId);
    expect(candidates.find((c) => c.id === attendeeId)).toBeUndefined();
  });

  it("never exposes contact details on candidates", async () => {
    const candidates = await attendees.listMatchCandidates(null);
    expect(candidates.some((c) => c.id === attendeeId)).toBe(true);
    for (const candidate of candidates) {
      expect(candidate).not.toHaveProperty("email");
      expect(candidate).not.toHaveProperty("phone");
    }
  });
});
