# Score validation attempt, 2026-09-25

Status: failed during the first query; **no complete evaluation or retrieval
metric** was produced. The initial preregistered validator allowed a 0.05
difference between Jev's native Score index and the index computed from its
ten returned probabilities. Live responses round each probability to two
decimals. One returned index differed by 0.08 and was rejected locally,
although the HTTP request succeeded. A second validation failure occurred
while concurrent work drained. The failure is a validator error, not evidence
that the Score hypothesis failed on MS MARCO.

The attempt recorded 21 API attempts, 19 accepted responses, two local
validation failures, and 11,211 input tokens in the accepted responses. The
estimated cost of accepted responses at the published rate is $0.000470862.
Usage and billing for the two rejected responses are unknown in this journal.
A separate synthetic preflight call used 528 input tokens, and two diagnostic
calls used 1,167 input tokens; their estimated combined cost is $0.000071190.
These are **not** part of the complete run cost.

The response check was widened to allow rounding error while preserving the
same question, ten weights, and weighted-probability ranking formula. The
revised protocol is committed before the new complete run. This directory
preserves the failed attempt. Its response cache stays outside Git and will
not be reused for the complete uncached run.

Evidence: [failure](failure.json), [attempts](attempts.jsonl),
[accepted scores](scores.jsonl), [attempt manifest](attempt-manifest.json).
