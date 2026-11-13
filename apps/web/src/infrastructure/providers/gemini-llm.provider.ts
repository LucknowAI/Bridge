import type { LlmProvider } from "../../application/ports/llm-provider";
import type { MatchCandidate } from "../../domain/matching/match-strategy";
import type { ParticipantProfile } from "../../domain/participant/participant.entity";

export class GeminiLlmProvider implements LlmProvider {
  async rerank(viewer: ParticipantProfile, candidates: MatchCandidate[]): Promise<MatchCandidate[]> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return candidates;
    const model = process.env.GEMINI_LLM_MODEL || "gemini-3.8-flash";
    const input = candidates.map(({ participant, score, mutualInterest }) => ({
      id: participant.attendeeId,
      name: participant.name,
      role: participant.designation,
      domain: participant.domain,
      about: participant.aboutMe,
      interests: participant.interests,
      intent: participant.intent,
      score,
      mutualInterest,
    }));
    const prompt = [
      "Rank these event networking candidates for the signed-in participant.",
      "Use collaboration potential, complementary experience, and shared intent.",
      "Return only JSON: an array of {id, reason}. Each reason must be one short sentence.",
      `Participant: ${JSON.stringify({ role: viewer.designation, domain: viewer.domain, about: viewer.aboutMe, interests: viewer.interests, intent: viewer.intent })}`,
      `Candidates: ${JSON.stringify(input)}`,
    ].join("\n");

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 2048, responseMimeType: "application/json" },
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error(`Gemini rerank failed (${response.status}): ${(await response.text()).slice(0, 300)}`);
    const payload = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    const raw = payload.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("") ?? "";
    const parsed = JSON.parse(raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")) as Array<{ id?: string; reason?: string }>;
    if (!Array.isArray(parsed)) throw new Error("Gemini rerank response was not an array");

    const byId = new Map(candidates.map((candidate) => [candidate.participant.attendeeId, candidate]));
    const ranked: MatchCandidate[] = [];
    const used = new Set<string>();
    for (const item of parsed) {
      if (typeof item.id !== "string" || used.has(item.id)) continue;
      const candidate = byId.get(item.id);
      if (!candidate) continue;
      used.add(item.id);
      ranked.push({ ...candidate, reason: typeof item.reason === "string" ? item.reason.slice(0, 300) : candidate.reason });
    }
    for (const candidate of candidates) if (!used.has(candidate.participant.attendeeId)) ranked.push(candidate);
    return ranked;
  }
}
