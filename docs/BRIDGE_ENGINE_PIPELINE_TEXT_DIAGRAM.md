# Bridge Engine — Matching & Search Pipeline (Text Diagram)

Plain-text/ASCII version of the pipeline diagram, for contexts where Mermaid/image rendering isn't available.

Legend: `[P]` Participant-facing · `[S]` System stage · `[C]` Cache/store · `[GW]` LLM Gateway

```
[P]Participant profile          [P]Search query
(structured + free text)        (text / filters)
        |                               |
        |                               | query embed
        +---------------+---------------+
                         v
                  [S]Embed
           (text-embedding via gateway)
                         ^
                         : embed
                     [GW]LLM Gateway
                (swap model · fallback · cost)
                         |
                         v
              [S]Retrieve — pgvector ANN
                ~50 nearest in this event
                         |
                         +-----------------------------+
                         | (main path)                 | search path
                         v                              v
              [S]Intent-compatibility filter     [C]Redis cache
                  (Specification rules)         (shared retrieval ·
                         |                        single-flight lock)
                         v
          [S]Composite score (personal)
   semantic · intent · domain · interest ·
        complementarity · seniority
                         |
                         +-------------------------+
                         | both directions          |
                         v                           v
                  [S]Take top ~12          [P]Mutual-interest flag
                         |                  score(A->B) & score(B->A) both high
                         v
     [S]LLM rerank + "why you should meet"
        (top-12 only · cached per pair)  <---- rerank ---- [GW]LLM Gateway
                         |
          +--------------+--------------+
          | matching path                | search path
          v                               v
   [C]Persist matches             [P]Instant search results
   + score_breakdown                 (personal order)
```

## Notes

- Two entry points (`Participant profile` and `Search query`) converge at `Embed` and stay on one shared pipeline through `Retrieve`, `Filter`, `Score`, `Take top ~12`, and `LLM rerank`.
- The `LLM Gateway` is called at two points only: `embed` and `rerank` — it is cross-cutting infra, not a pipeline stage.
- `Redis cache` is used only on the search path, off `Retrieve`, to keep repeated/concurrent searches cheap.
- `Mutual-interest flag` branches off `Composite score`, comparing score(A→B) and score(B→A) — it is not a separate pipeline stage.
- The pipeline ends in two different outputs depending on entry point: `Persist matches` (matching path) vs. `Instant search results` (search path).
