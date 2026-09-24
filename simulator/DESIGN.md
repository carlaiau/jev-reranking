# Signal routing board

The simulator is a control surface for watching a fixed stream of search candidates change order. Every ranking position is a lane. The active query is the signal being routed; JEV scores are switches, and judgment marks stay attached to documents as they move.

## Visual system

- Deep ink panels with warm chalk text, hairline copper route marks, one electric mint success signal, and amber for pending decisions. Human judgments use a distinct grade treatment and explicit words; color is never the only label.
- A compact expressive grotesk for headings, a readable sans for explanations, and monospaced figures only for document IDs, score values and call payloads.
- Square-edged, precisely spaced control strips; softly rounded buttons and select controls inherited from the sibling Catalyst set. No decorative card grid.
- A broad ranking field on desktop. On narrow screens, the same lane rows become a single column, with controls and metric comparison visible before the list.

## First surface

The first viewport states the idea in one sentence: BM25 retrieves; JEV judges the candidates again. A fixed pipeline strip identifies the saved 1,000-result WSJ stage-1 run, top-100 JEV scoring boundary, and unchanged candidate pool. Task and query controls sit directly above an always-visible before/after metric scoreline. The ranking field shows the first ten results and one clear replay action.

## Signature interaction

On replay, score lamps light in short staggered groups along the candidate lanes. The list then reorders in place with position-preserving animation; judgment marks travel with their documents. Metric digits count to recorded values. Every result can open its article, the request shape and the recorded score/usage. Replay is deterministic and never calls JEV.

## Motion grammar

Motion communicates state and movement. Lanes cross only during reranking. Numerals animate at their fixed positions. An ambient rail scan is quiet and slow. Reduced-motion users receive instant state changes and fully readable before/after views.

## Product truth

WSJ is the lead because the recorded stage-1 ranking is BM25. The two task choices are complete-document and passage-MaxP JEV reranking of the same saved top-100 candidates. Text stays outside Git and is read by the local server from a provisioned collection file. Aggregate metrics, query metrics, ranks, judgments and scores come from completed artifacts.
