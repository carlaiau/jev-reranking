/*
	JASSjr_search.go
	----------------
	Copyright (c) 2024 Vaughan Kitchen
	Minimalistic BM25 search engine.
	from https://github.com/andrewtrotman/JASSjr
*/

package main

import (
	"bufio"
	"bytes"
	"cmp"
	"encoding/binary"
	"fmt"
	"math"
	"os"
	"slices"
	"strconv"
	"strings"
)

/*
Constants
---------
*/
const defaultK1 = 0.7 // BM25 k1 parameter
const defaultB = 0.3  // BM25 b parameter
const defaultFeedbackDocs = 5
const defaultExpansionTerms = 6
const defaultExpansionWeight = 0.45
const defaultExpansionMaxQueryTerms = 6
const sparseFeedbackDocsBonus = 3
const sparseExpansionTermsBonus = 4
const sparseExpansionWeightBonus = 0.10
const partialFeedbackDocsBonus = 2
const partialExpansionTermsBonus = 2
const partialExpansionWeightBonus = 0.05
const defaultRerankDocs = 25
const defaultRerankPassageWindow = 16
const defaultRerankPassageWeight = 0.20

var bm25K1 = defaultK1
var bm25B = defaultB
var feedbackDocs = defaultFeedbackDocs
var expansionTerms = defaultExpansionTerms
var expansionWeight = defaultExpansionWeight
var expansionMaxQueryTerms = defaultExpansionMaxQueryTerms
var expansionOnlyMode = false
var rerankDocs = defaultRerankDocs
var rerankPassageWindow = defaultRerankPassageWindow
var rerankPassageWeight = defaultRerankPassageWeight

/*
Struct vocabEntry
-----------------
*/
type vocabEntry struct {
	where, size int32 // where on the disk and how large (in bytes) is the postings list?
}

type loadedIndex struct {
	docLengths            []int32
	averageDocumentLength float64
	documentsInCollection int
	postingsFile          *os.File
	dictionary            map[string]vocabEntry
}

type weightedQueryTerm struct {
	token  string
	weight float64
}

type feedbackCandidate struct {
	token  string
	weight float64
}

type querySignal struct {
	token  string
	weight float64
	idf    float64
}

type matchedOccurrence struct {
	position  int
	termIndex int
}

func check(e error) {
	if e != nil {
		panic(e)
	}
}

func floatFromEnv(name string, fallback float64) float64 {
	raw := os.Getenv(name)
	if raw == "" {
		return fallback
	}

	value, err := strconv.ParseFloat(raw, 64)
	if err != nil {
		panic(fmt.Sprintf("%s must be a floating-point number: %v", name, err))
	}
	return value
}

func intFromEnv(name string, fallback int) int {
	raw := os.Getenv(name)
	if raw == "" {
		return fallback
	}

	value, err := strconv.Atoi(raw)
	if err != nil {
		panic(fmt.Sprintf("%s must be an integer: %v", name, err))
	}
	return value
}

func configureRankingParameters() {
	bm25K1 = floatFromEnv("JASSJR_BM25_K1", defaultK1)
	bm25B = floatFromEnv("JASSJR_BM25_B", defaultB)
	feedbackDocs = intFromEnv("JASSJR_FEEDBACK_DOCS", defaultFeedbackDocs)
	expansionTerms = intFromEnv("JASSJR_EXPANSION_TERMS", defaultExpansionTerms)
	expansionWeight = floatFromEnv("JASSJR_EXPANSION_WEIGHT", defaultExpansionWeight)
	expansionMaxQueryTerms = intFromEnv("JASSJR_EXPANSION_MAX_QUERY_TERMS", defaultExpansionMaxQueryTerms)
	expansionOnlyMode = os.Getenv("JASSJR_EXPANSION_ONLY") == "1"
	rerankDocs = intFromEnv("JASSJR_RERANK_DOCS", defaultRerankDocs)
	rerankPassageWindow = intFromEnv("JASSJR_RERANK_PASSAGE_WINDOW", defaultRerankPassageWindow)
	rerankPassageWeight = floatFromEnv("JASSJR_RERANK_PASSAGE_WEIGHT", defaultRerankPassageWeight)

	if bm25K1 < 0 {
		panic("JASSJR_BM25_K1 must be non-negative")
	}
	if bm25B < 0 || bm25B > 1 {
		panic("JASSJR_BM25_B must be between 0 and 1")
	}
	if feedbackDocs < 0 {
		panic("JASSJR_FEEDBACK_DOCS must be non-negative")
	}
	if expansionTerms < 0 {
		panic("JASSJR_EXPANSION_TERMS must be non-negative")
	}
	if expansionWeight < 0 {
		panic("JASSJR_EXPANSION_WEIGHT must be non-negative")
	}
	if expansionMaxQueryTerms < 0 {
		panic("JASSJR_EXPANSION_MAX_QUERY_TERMS must be non-negative")
	}
	if rerankDocs < 0 {
		panic("JASSJR_RERANK_DOCS must be non-negative")
	}
	if rerankPassageWindow <= 0 {
		panic("JASSJR_RERANK_PASSAGE_WINDOW must be positive")
	}
	if rerankPassageWeight < 0 {
		panic("JASSJR_RERANK_PASSAGE_WEIGHT must be non-negative")
	}
}

func loadIndex(lengthsPath string, postingsPath string, vocabPath string) loadedIndex {
	lengthsAsBytes, err := os.ReadFile(lengthsPath)
	check(err)
	docLengths := make([]int32, len(lengthsAsBytes)/4)
	err = binary.Read(bytes.NewReader(lengthsAsBytes), binary.NativeEndian, docLengths)
	check(err)

	documentsInCollection := len(docLengths)
	averageDocumentLength := 0.0
	for _, which := range docLengths {
		averageDocumentLength += float64(which)
	}
	if documentsInCollection > 0 {
		averageDocumentLength /= float64(documentsInCollection)
	}

	postingsFile, err := os.Open(postingsPath)
	check(err)

	dictionary := make(map[string]vocabEntry)
	vocabAsBytes, err := os.ReadFile(vocabPath)
	check(err)
	for offset := 0; offset < len(vocabAsBytes); {
		strLength := int(vocabAsBytes[offset])
		offset += 1

		term := string(vocabAsBytes[offset : offset+strLength])
		offset += strLength + 1 // read the '\0' string terminator

		where := binary.NativeEndian.Uint32(vocabAsBytes[offset:])
		offset += 4
		size := binary.NativeEndian.Uint32(vocabAsBytes[offset:])
		offset += 4

		dictionary[term] = vocabEntry{int32(where), int32(size)}
	}

	return loadedIndex{
		docLengths:            docLengths,
		averageDocumentLength: averageDocumentLength,
		documentsInCollection: documentsInCollection,
		postingsFile:          postingsFile,
		dictionary:            dictionary,
	}
}

func bm25Score(tf float64, docLength int32, averageDocumentLength float64) float64 {
	if averageDocumentLength == 0 {
		return (tf * (bm25K1 + 1)) / (tf + bm25K1)
	}
	return (tf * (bm25K1 + 1)) / (tf + bm25K1*(1-bm25B+bm25B*(float64(docLength)/averageDocumentLength)))
}

func accumulateScores(index loadedIndex, token string, queryWeight float64, rsv []float64, touchedDocs *[]int) {
	termDetails, ok := index.dictionary[token]
	if !ok {
		return
	}

	currentListAsBytes := make([]byte, termDetails.size)
	_, err := index.postingsFile.ReadAt(currentListAsBytes, int64(termDetails.where))
	check(err)
	currentList := make([]int32, len(currentListAsBytes)/4)
	err = binary.Read(bytes.NewReader(currentListAsBytes), binary.NativeEndian, currentList)
	check(err)
	postings := len(currentListAsBytes) / 8

	if index.documentsInCollection == postings {
		return
	}

	idf := math.Log(float64(index.documentsInCollection) / float64(postings))

	for i := 0; i < len(currentList); i += 2 {
		d := int(currentList[i])
		tf := float64(currentList[i+1])
		if rsv[d] == 0 {
			*touchedDocs = append(*touchedDocs, d)
		}
		rsv[d] += queryWeight * idf * bm25Score(tf, index.docLengths[d], index.averageDocumentLength)
	}
}

func scoreQuery(index loadedIndex, queryTerms []weightedQueryTerm, rsv []float64, touchedDocs []int) []int {
	touchedDocs = touchedDocs[:0]
	for _, term := range queryTerms {
		accumulateScores(index, term.token, term.weight, rsv, &touchedDocs)
	}

	return sortResults(rsv, touchedDocs)
}

func sortResults(rsv []float64, touchedDocs []int) []int {
	slices.SortFunc(touchedDocs, func(a, b int) int {
		if diff := cmp.Compare(rsv[b], rsv[a]); diff != 0 {
			return diff
		}
		return cmp.Compare(b, a)
	})

	return touchedDocs
}

func buildQuerySignals(index loadedIndex, queryTerms []weightedQueryTerm) ([]querySignal, map[string]int) {
	querySignals := make([]querySignal, 0, len(queryTerms))
	querySignalIndex := make(map[string]int, len(queryTerms))

	for _, term := range queryTerms {
		if signalIndex, exists := querySignalIndex[term.token]; exists {
			querySignals[signalIndex].weight += term.weight
			continue
		}

		termDetails, ok := index.dictionary[term.token]
		if !ok {
			continue
		}
		postings := int(termDetails.size / 8)
		if postings == 0 || postings == index.documentsInCollection {
			continue
		}

		querySignalIndex[term.token] = len(querySignals)
		querySignals = append(querySignals, querySignal{
			token:  term.token,
			weight: term.weight,
			idf:    math.Log(float64(index.documentsInCollection) / float64(postings)),
		})
	}

	return querySignals, querySignalIndex
}

func readForwardDocTerms(forwardFile *os.File, forwardOffsets []int64, docID int) map[string]int32 {
	offset := forwardOffsets[docID*2]
	size := forwardOffsets[docID*2+1]
	if size == 0 {
		return nil
	}

	buffer := make([]byte, int(size))
	_, err := forwardFile.ReadAt(buffer, offset)
	check(err)

	docTerms := make(map[string]int32)
	for current := 0; current < len(buffer); {
		strLength := int(buffer[current])
		current++
		term := string(buffer[current : current+strLength])
		current += strLength
		docTerms[term]++
	}
	return docTerms
}

func readForwardDocMatches(forwardFile *os.File, forwardOffsets []int64, docID int, querySignalIndex map[string]int) []matchedOccurrence {
	offset := forwardOffsets[docID*2]
	size := forwardOffsets[docID*2+1]
	if size == 0 {
		return nil
	}

	buffer := make([]byte, int(size))
	_, err := forwardFile.ReadAt(buffer, offset)
	check(err)

	occurrences := make([]matchedOccurrence, 0, 16)
	position := 0
	for current := 0; current < len(buffer); {
		strLength := int(buffer[current])
		current++
		token := string(buffer[current : current+strLength])
		current += strLength

		if termIndex, ok := querySignalIndex[token]; ok {
			occurrences = append(occurrences, matchedOccurrence{
				position:  position,
				termIndex: termIndex,
			})
		}
		position++
	}

	return occurrences
}

func bestPassageScore(querySignals []querySignal, occurrences []matchedOccurrence) float64 {
	if len(querySignals) < 2 || len(occurrences) < 2 {
		return 0
	}

	bestScore := 0.0
	counts := make([]int32, len(querySignals))
	touchedTerms := make([]int, 0, len(querySignals))

	for end := 0; end < len(occurrences); end++ {
		endPosition := occurrences[end].position
		touchedTerms = touchedTerms[:0]
		matchedTerms := 0

		for start := end; start >= 0; start-- {
			windowLength := endPosition - occurrences[start].position + 1
			if windowLength > rerankPassageWindow {
				break
			}

			termIndex := occurrences[start].termIndex
			if counts[termIndex] == 0 {
				matchedTerms++
				touchedTerms = append(touchedTerms, termIndex)
			}
			counts[termIndex]++

			if matchedTerms < 2 {
				continue
			}

			passageScore := 0.0
			for _, activeTerm := range touchedTerms {
				signal := querySignals[activeTerm]
				passageScore += signal.weight * signal.idf * bm25Score(float64(counts[activeTerm]), int32(windowLength), float64(rerankPassageWindow))
			}

			if passageScore > bestScore {
				bestScore = passageScore
			}
		}

		for _, activeTerm := range touchedTerms {
			counts[activeTerm] = 0
		}
	}

	return bestScore
}

func rerankTopPassages(index loadedIndex, forwardFile *os.File, forwardOffsets []int64, queryTerms []weightedQueryTerm, rankedDocs []int, rsv []float64) []int {
	if rerankDocs == 0 || rerankPassageWeight == 0 {
		return rankedDocs
	}

	querySignals, querySignalIndex := buildQuerySignals(index, queryTerms)
	if len(querySignals) < 2 || len(rankedDocs) == 0 {
		return rankedDocs
	}

	limit := rerankDocs
	if len(rankedDocs) < limit {
		limit = len(rankedDocs)
	}

	rerankedPrefix := append([]int(nil), rankedDocs[:limit]...)
	for _, docID := range rerankedPrefix {
		passageScore := bestPassageScore(querySignals, readForwardDocMatches(forwardFile, forwardOffsets, docID, querySignalIndex))
		if passageScore == 0 {
			continue
		}
		rsv[docID] += rerankPassageWeight * passageScore
	}

	rerankedPrefix = sortResults(rsv, rerankedPrefix)
	rerankedDocs := make([]int, 0, len(rankedDocs))
	rerankedDocs = append(rerankedDocs, rerankedPrefix...)
	rerankedDocs = append(rerankedDocs, rankedDocs[limit:]...)
	return rerankedDocs
}

func adaptiveExpansionParameters(index loadedIndex, originalTerms map[string]struct{}) (int, int, float64) {
	feedbackDocLimit := feedbackDocs
	expansionTermLimit := expansionTerms
	expansionTermWeight := expansionWeight

	indexedOriginalTerms := 0
	for term := range originalTerms {
		if _, ok := index.dictionary[term]; ok {
			indexedOriginalTerms++
		}
	}

	switch {
	case len(originalTerms) <= 2 || indexedOriginalTerms <= 1:
		feedbackDocLimit += sparseFeedbackDocsBonus
		expansionTermLimit += sparseExpansionTermsBonus
		expansionTermWeight = math.Min(expansionTermWeight+sparseExpansionWeightBonus, 0.75)
	case indexedOriginalTerms < len(originalTerms):
		feedbackDocLimit += partialFeedbackDocsBonus
		expansionTermLimit += partialExpansionTermsBonus
		expansionTermWeight = math.Min(expansionTermWeight+partialExpansionWeightBonus, 0.75)
	}

	return feedbackDocLimit, expansionTermLimit, expansionTermWeight
}

func selectExpansionTerms(index loadedIndex, forwardFile *os.File, forwardOffsets []int64, rankedDocs []int, rsv []float64, originalTerms map[string]struct{}, feedbackDocLimit int, expansionTermLimit int, expansionTermWeight float64) []weightedQueryTerm {
	if feedbackDocLimit == 0 || expansionTermLimit == 0 || expansionTermWeight == 0 {
		return nil
	}

	limit := feedbackDocLimit
	if len(rankedDocs) < limit {
		limit = len(rankedDocs)
	}
	if limit == 0 {
		return nil
	}

	docMassTotal := 0.0
	for rank := 0; rank < limit; rank++ {
		docMassTotal += math.Max(rsv[rankedDocs[rank]], 0)
	}

	candidates := make(map[string]feedbackCandidate)
	for rank := 0; rank < limit; rank++ {
		docID := rankedDocs[rank]
		docLength := float64(index.docLengths[docID])
		if docLength <= 0 {
			continue
		}

		docWeight := 1.0 / float64(rank+1)
		if docMassTotal > 0 {
			docWeight = math.Max(rsv[docID], 0) / docMassTotal
		}

		for term, tf := range readForwardDocTerms(forwardFile, forwardOffsets, docID) {
			if _, exists := originalTerms[term]; exists {
				continue
			}

			termDetails, ok := index.dictionary[term]
			if !ok {
				continue
			}
			postings := int(termDetails.size / 8)
			if postings == 0 || postings == index.documentsInCollection {
				continue
			}

			idf := math.Log(float64(index.documentsInCollection) / float64(postings))
			candidate := candidates[term]
			candidate.token = term
			candidate.weight += docWeight * (float64(tf) / docLength) * idf
			candidates[term] = candidate
		}
	}

	selected := make([]feedbackCandidate, 0, len(candidates))
	for _, candidate := range candidates {
		selected = append(selected, candidate)
	}

	slices.SortFunc(selected, func(a, b feedbackCandidate) int {
		if diff := cmp.Compare(b.weight, a.weight); diff != 0 {
			return diff
		}
		return cmp.Compare(a.token, b.token)
	})

	if len(selected) > expansionTermLimit {
		selected = selected[:expansionTermLimit]
	}

	expansions := make([]weightedQueryTerm, 0, len(selected))
	totalWeight := 0.0
	for _, candidate := range selected {
		totalWeight += candidate.weight
	}
	for _, candidate := range selected {
		weight := expansionTermWeight / float64(len(selected))
		if totalWeight > 0 {
			weight = expansionTermWeight * candidate.weight / totalWeight
		}
		expansions = append(expansions, weightedQueryTerm{token: candidate.token, weight: weight})
	}
	return expansions
}

func normalizeToken(token string) string {
	token = strings.ToLower(token)

	switch {
	case len(token) > 4 && strings.HasSuffix(token, "ies"):
		return token[:len(token)-3] + "y"
	case len(token) > 4 && strings.HasSuffix(token, "sses"):
		return token[:len(token)-2]
	case len(token) > 4 && (strings.HasSuffix(token, "ches") || strings.HasSuffix(token, "shes") || strings.HasSuffix(token, "xes") || strings.HasSuffix(token, "zes")):
		return token[:len(token)-2]
	case len(token) > 3 && strings.HasSuffix(token, "s") &&
		!strings.HasSuffix(token, "ss") &&
		!strings.HasSuffix(token, "us") &&
		!strings.HasSuffix(token, "is") &&
		token != "news":
		return token[:len(token)-1]
	default:
		return token
	}
}

/*
main()
------
Simple search engine ranking on BM25.
*/
func main() {
	configureRankingParameters()

	index := loadIndex("lengths.bin", "postings.bin", "vocab.bin")
	defer index.postingsFile.Close()

	/*
	  Read the primary keys
	*/
	primaryKeysAsBytes, err := os.ReadFile("docids.bin")
	check(err)
	// This isn't performant for large files. Prefer bufio.Scanner there
	// But for small files like what we have here it is faster
	primaryKeys := strings.Split(string(primaryKeysAsBytes), "\n")

	/*
	  Read the per-document forward vectors used for pseudo-relevance feedback.
	*/
	forwardOffsetsAsBytes, err := os.ReadFile("forward_offsets.bin")
	check(err)
	forwardOffsets := make([]int64, len(forwardOffsetsAsBytes)/8)
	err = binary.Read(bytes.NewReader(forwardOffsetsAsBytes), binary.NativeEndian, forwardOffsets)
	check(err)
	if len(forwardOffsets) != index.documentsInCollection*2 {
		panic("forward_offsets.bin must contain offset/size pairs for every document")
	}
	forwardFile, err := os.Open("forward.bin")
	check(err)
	defer forwardFile.Close()

	/*
	  Allocate buffers for score accumulation. We only track
	  the documents touched by the current query to avoid
	  sorting the whole collection when most scores are zero.
	*/
	rsv := make([]float64, index.documentsInCollection)
	touchedDocs := make([]int, 0, 1024)

	/*
	  Search (one query per line)
	*/
	stdin := bufio.NewScanner(os.Stdin)
	for stdin.Scan() {
		queryId := 0
		queryTerms := make([]weightedQueryTerm, 0, 16)
		originalTerms := make(map[string]struct{}, 16)
		for i, token := range strings.Fields(stdin.Text()) {
			/*
			  If the first token is a number then assume a TREC query number, and skip it
			*/
			if i == 0 {
				if num, err := strconv.Atoi(token); err == nil {
					queryId = num
					continue
				}
			}

			token = normalizeToken(token)
			queryTerms = append(queryTerms, weightedQueryTerm{token: token, weight: 1.0})
			originalTerms[token] = struct{}{}
		}

		touchedDocs = scoreQuery(index, queryTerms, rsv, touchedDocs)
		if expansionMaxQueryTerms == 0 || len(queryTerms) <= expansionMaxQueryTerms {
			feedbackDocLimit, expansionTermLimit, expansionTermWeight := adaptiveExpansionParameters(index, originalTerms)
			expansions := selectExpansionTerms(index, forwardFile, forwardOffsets, touchedDocs, rsv, originalTerms, feedbackDocLimit, expansionTermLimit, expansionTermWeight)
			if len(expansions) > 0 {
				if expansionOnlyMode {
					for _, d := range touchedDocs {
						rsv[d] = 0
					}
					touchedDocs = touchedDocs[:0]
				}
				for _, expansion := range expansions {
					accumulateScores(index, expansion.token, expansion.weight, rsv, &touchedDocs)
				}
				touchedDocs = sortResults(rsv, touchedDocs)
			}
		}
		touchedDocs = rerankTopPassages(index, forwardFile, forwardOffsets, queryTerms, touchedDocs, rsv)

		/*
		  Print the (at most) top 1000 documents in the results list in TREC eval format which is:
		  query-id Q0 document-id rank score run-name
		*/
		for i, r := range touchedDocs {
			if i == 1000 {
				break
			}
			fmt.Printf("%d Q0 %s %d %.4f JASSjr\n", queryId, primaryKeys[r], i+1, rsv[r])
		}
		for _, d := range touchedDocs {
			rsv[d] = 0
		}
	}
	if err := stdin.Err(); err != nil {
		panic(err)
	}
}
