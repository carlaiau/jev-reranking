CREATE SCHEMA IF NOT EXISTS simulator;

CREATE TABLE IF NOT EXISTS simulator.collections (
  id text PRIMARY KEY CHECK (id IN ('wsj', 'msmarco')),
  evidence_sha256 text NOT NULL,
  source jsonb NOT NULL,
  tasks jsonb NOT NULL,
  aggregate_before jsonb,
  aggregate_after jsonb,
  reference_metrics jsonb
);

CREATE TABLE IF NOT EXISTS simulator.queries (
  collection_id text NOT NULL REFERENCES simulator.collections(id),
  query_id text NOT NULL,
  query_text text NOT NULL,
  PRIMARY KEY (collection_id, query_id)
);

CREATE TABLE IF NOT EXISTS simulator.documents (
  collection_id text NOT NULL REFERENCES simulator.collections(id),
  doc_id text NOT NULL,
  title text NOT NULL,
  passage_text text,
  PRIMARY KEY (collection_id, doc_id),
  CONSTRAINT wsj_has_no_article_text CHECK (collection_id <> 'wsj' OR passage_text IS NULL)
);

CREATE TABLE IF NOT EXISTS simulator.candidates (
  collection_id text NOT NULL,
  query_id text NOT NULL,
  doc_id text NOT NULL,
  baseline_rank integer NOT NULL CHECK (baseline_rank > 0),
  judgment smallint,
  PRIMARY KEY (collection_id, query_id, doc_id),
  UNIQUE (collection_id, query_id, baseline_rank),
  FOREIGN KEY (collection_id, query_id) REFERENCES simulator.queries(collection_id, query_id)
);

CREATE TABLE IF NOT EXISTS simulator.query_runs (
  collection_id text NOT NULL,
  query_id text NOT NULL,
  task text NOT NULL,
  before_metrics jsonb NOT NULL,
  after_metrics jsonb NOT NULL,
  seconds double precision NOT NULL,
  calls integer NOT NULL,
  PRIMARY KEY (collection_id, query_id, task),
  FOREIGN KEY (collection_id, query_id) REFERENCES simulator.queries(collection_id, query_id)
);

CREATE TABLE IF NOT EXISTS simulator.reranked_results (
  collection_id text NOT NULL,
  query_id text NOT NULL,
  task text NOT NULL,
  doc_id text NOT NULL,
  final_rank integer NOT NULL CHECK (final_rank > 0),
  PRIMARY KEY (collection_id, query_id, task, doc_id),
  UNIQUE (collection_id, query_id, task, final_rank),
  FOREIGN KEY (collection_id, query_id, doc_id) REFERENCES simulator.candidates(collection_id, query_id, doc_id),
  FOREIGN KEY (collection_id, query_id, task) REFERENCES simulator.query_runs(collection_id, query_id, task)
);

CREATE TABLE IF NOT EXISTS simulator.calls (
  collection_id text NOT NULL,
  query_id text NOT NULL,
  task text NOT NULL,
  doc_id text NOT NULL,
  call_index integer NOT NULL,
  score double precision NOT NULL,
  input_tokens integer NOT NULL,
  output_tokens integer NOT NULL,
  model text NOT NULL,
  seconds double precision NOT NULL,
  payload_characters integer NOT NULL,
  payload_hash text NOT NULL,
  cache_hit boolean NOT NULL,
  passage_index integer,
  token_start integer,
  token_end integer,
  document_tokens integer,
  matched_payload text,
  PRIMARY KEY (collection_id, query_id, task, doc_id, call_index),
  FOREIGN KEY (collection_id, query_id, task, doc_id)
    REFERENCES simulator.reranked_results(collection_id, query_id, task, doc_id),
  CONSTRAINT wsj_has_no_call_text CHECK (collection_id <> 'wsj' OR matched_payload IS NULL)
);
