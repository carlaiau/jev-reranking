# A quiet ranking workspace

The result order is the visual explanation. Choosing a query replays its saved retrieval step; JEV then moves the rows and changes the metrics automatically after a short pause.

## Layout and type

- One broad reading column: query, quality table, ranked results, then aggregate evidence.
- Light mode by default: warm off-white ground, white data surfaces, deep green for the one primary action and improvement. Dark mode keeps the same hierarchy.
- One text family with a restrained scale. Monospace appears only for document IDs and request JSON.
- Horizontal row dividers support scanning. No decorative rails, status glows, stage cards, or repeated labels.

## Interaction

- WSJ shows the fixed BM25 ranking followed by complete-document JEV reranking. MS MARCO loads its saved monoBERT reference ranking, then shows JEV on the original supplied passage text. The second step starts automatically after initial load or a query change; the table's Replay JEV button repeats it. The query selector remains pinned while the results scroll beneath it.
- Ten results remain visible. Human judgments can be hidden, and each result opens source details and its recorded JEV call.
- Score digits and result positions animate during replay. Reduced-motion users receive an immediate, readable change.
- Theme choice persists locally. The toggle and all controls stay reachable on narrow screens.

## Evidence boundary

Query and aggregate metrics come from saved runs. The WSJ view evaluates only the reranked top 100 and names that cutoff beside the numbers; its source context gives the TREC-1 corpus size and article count. WSJ article names may appear, but full article text never enters the browser; the call view shows only a short excerpt and the recorded source-token count. The MS MARCO comparison starts from monoBERT, since the supplied candidate file order is not a lexical ranking.
