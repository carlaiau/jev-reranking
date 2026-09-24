# A quiet ranking workspace

The result order is the visual explanation. Choosing a query replays its saved retrieval step; the JEV replay then moves the rows and changes the metrics.

## Layout and type

- One broad reading column: query, quality table, ranked results, then aggregate evidence.
- Light mode by default: warm off-white ground, white data surfaces, deep green for the one primary action and improvement. Dark mode keeps the same hierarchy.
- One text family with a restrained scale. Monospace appears only for document IDs and request JSON.
- Horizontal row dividers support scanning. No decorative rails, status glows, stage cards, or repeated labels.

## Interaction

- WSJ shows the fixed BM25 ranking followed by complete-document JEV reranking. MS MARCO loads its saved monoBERT reference ranking, then shows JEV on the original supplied passage text. Changing the query starts the first step; the table's Replay JEV button starts the second.
- Ten results remain visible. Human judgments can be hidden, and each result opens source details and its recorded JEV call.
- Score digits and result positions animate during replay. Reduced-motion users receive an immediate, readable change.
- Theme choice persists locally. The toggle and all controls stay reachable on narrow screens.

## Evidence boundary

Query and aggregate metrics come from saved runs. WSJ article names may appear, but full article text never enters the browser; the call view shows only a short excerpt and the recorded source-token count. The MS MARCO comparison starts from monoBERT, since the supplied candidate file order is not a lexical ranking.
