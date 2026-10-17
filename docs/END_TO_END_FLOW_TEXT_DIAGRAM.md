# Bridge — End-to-End Flow (Text Diagram)

Plain-text/ASCII version of the flow diagram, for contexts where Mermaid/image rendering isn't available.

Legend: `[O]` Organizer · `[P]` Participant · `[S]` System (automatic)

```
[O]1.Create event
      |
      v
[O]2.Import roster (Excel)
      |
      v
[O]3.Configure form · intents · zones
      |
      v
[O]4.Open registration + compute matches
      | event live
      v
[P]5.Claim login (same email / phone)
      |
      v
[P]6.Build profile + set intent
      |
      +---------------------------------+
      | on save                         | anytime
      v                                 v
[S]Embed profile (async worker)    [P]Search / discover (query, anytime)
      |                                 |
      v                                 v
[S]Precompute matches (pipeline)   [S]Retrieve (shared · cached)
      | precomputed                    |
      v                                 v
[P]7.See ranked matches            [S]Rank (personal score)
   + "why you should meet"              |
      |                                 v
      |                            [P]Instant results +
      |                               mutual-interest flag
      |                                 |
      +----------------+----------------+
                        | request intro
                        v
                  [P]8.Request intro
                        |
                        v
                  [P]9.Mutual accept -> reveal contact
                        |
                        v
                  [P]10."Where are you?" ping -> venue zone
                        |
                        v
                  [P]11.Meet in person
```

## Notes

- Steps 6 onward fork into two parallel paths (precomputed matches vs. live search) that both converge back at step 8, "Request intro."
- `on save` = triggered when a participant saves their profile (eager/background computation).
- `anytime` = triggered on-demand whenever a participant runs a search (on-demand computation).
