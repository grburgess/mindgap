export const meta = {
  name: 'integrated-precedent-fanout',
  description: 'Has anyone solved the FULL combined retrieval+identity+incremental spec? 6 domain scouts + requirements-matrix judge + synthesis',
  phases: [
    { title: 'Scout', detail: '6 domains hunting integrated systems (opus)' },
    { title: 'Judge', detail: 'requirements matrix R1-R10 (ceiling, high effort)' },
    { title: 'Synthesize', detail: 'verdict + composite recipe (ceiling)' },
  ],
}

const SPEC = `OUR COMBINED SPEC (the full set of asks; do NOT read files — use WebSearch/WebFetch only):
Has anyone solved the FULL combined spec: hybrid retrieval + stable result identity across index rebuilds + incremental updates, on a corpus of this size and query mix?
Data: 12M-document corpus, nightly full reindex, mixed navigational/exploratory query traffic, a BM25 index and a frozen dense encoder already in production, ~8k human-rated relevance pairs, 3 years of position-biased click logs, eval set suspected of author overlap with the training corpus.
REQUIREMENTS a candidate system is scored against:
R1 hybrid lexical + dense retrieval fused into one ranking (not one arm chosen per deployment)
R2 index updates without a full reindex — new documents searchable without a full rebuild
R3 stable result identity across rebuilds: the same document keeps the same result ID release to release
R4 latency discipline: end-to-end p95 <=250ms including any reranking stage
R5 leakage-free evaluation: train/eval separation the system's own reported numbers actually respect
R6 incremental ingestion as normal operation, not a batch migration
R7 an explicit, tunable precision/latency knob rather than a fixed architecture point
R8 auditable ranking decisions: why a document ranked where it did is recoverable after the fact
R9 no per-query training or per-query optimisation at serving time
R10 label economy: order 10^3 human judgements, active/exception-driven, not 10^5-10^6 dense labels
TASK: find INTEGRATED SYSTEMS (production or published) that solve MANY of these AT ONCE on similar data — not single-technique papers. For each candidate: name, one primary citation (title, venue_year, url — arxiv/tech-report/docs page you actually found), the data regime it runs on, per-requirement scores R1-R10 (yes / partial / no / unknown, with one-line justification for every yes/partial), and honest gaps. 3-6 candidates per domain. If your domain has NO integrated system, say so explicitly and name the closest partial. Do not fabricate; every url must come from your actual searches.`

const DOMAINS = [
  { key: 'web-scale-search', prompt: 'DOMAIN: web-scale production search engines and the open stacks behind them. Published Google/Bing ranking-stack descriptions, Lucene and its near-real-time segment model, Elasticsearch/OpenSearch (native RRF hybrid retrieval), Vespa (single engine doing sparse + dense + reranking), Solr, Algolia. These ship at scale — check hard what they actually guarantee rather than what the marketing page says: does a document keep the same result identity across a full reindex, or only across segment merges? What is the documented hybrid-fusion mechanism, what does it cost at p95, and is the fused ranking explainable after the fact?' },
  { key: 'recommender-systems', prompt: 'DOMAIN: production recommender and candidate-generation systems — the closest operational analog to serving a fused ranking under a hard latency budget: two-tower retrieval + reranking cascades, published YouTube/Pinterest/Netflix/Alibaba architectures, real-time item ingestion and cold-start paths, embedding versioning across retrains (do item vectors stay comparable, or does every retrain invalidate the index?), and off-policy/counterfactual evaluation with propensity correction on logged interactions. Look for how they keep item identity stable across model refreshes and how they estimate quality without a clean held-out set.' },
  { key: 'enterprise-site-search', prompt: 'DOMAIN: enterprise and site-search PRODUCTS, where incremental ingestion is the whole business: Elastic Enterprise Search, Coveo, Glean, Algolia, Vespa Cloud, Azure AI Search, Amazon Kendra. These solve continuous connector-driven ingestion operationally rather than as a batch migration. Look for: documented hybrid (lexical + semantic) ranking, per-document update paths with no full reindex, permalink/document-ID stability across schema and index changes, published latency SLOs, and relevance tuning workflows that run on small judgement sets instead of large labelled corpora. Score them honestly on the evaluation requirements too.' },
  { key: 'vector-db-ann', prompt: 'DOMAIN: vector databases and the ANN index literature, 2020-2026: HNSW, IVF-PQ, DiskANN and FreshDiskANN (streaming inserts AND deletes without a full rebuild!), ScaNN, FAISS, and the systems layer on top — Milvus, Qdrant, Weaviate, pgvector, Turbopuffer. Key questions: which index families genuinely support incremental insert/delete versus which quietly require periodic full rebuilds; what happens to recall as an index drifts between rebuilds; whether internal vector IDs persist across compaction; and what native sparse+dense hybrid search each exposes, with what tuning knob and what measured latency.' },
  { key: 'rag-qa-systems', prompt: 'DOMAIN: retrieval-augmented generation and open-domain QA systems, 2021-2026: DPR, ColBERT/PLAID late interaction, SPLADE learned sparse, hybrid pipelines in LlamaIndex and Haystack, production RAG stacks with citation-stable answers, and multi-stage rerank cascades. Key question: does ANY of these maintain stable passage/chunk identity across corpus refreshes — so a citation issued last month still resolves — while ingesting new documents incrementally? Also check honestly how they evaluate: most report on benchmarks whose train/test separation they never audit, which is exactly our leakage requirement.' },
  { key: 'ltr-ir-benchmarks', prompt: 'DOMAIN: the evaluation and supervision problem OUTSIDE systems work: academic learning-to-rank and IR benchmarking — MS MARCO and TREC Deep Learning, BEIR zero-shot generalisation, LambdaMART/LightGBM rankers, unbiased learning-to-rank (inverse propensity scoring, dual learning, randomisation-estimated propensities), interleaving and counterfactual evaluation, and active/pool-based judgement collection at order-10^3 labels. Score against the spec where meaningful; the evaluation and label requirements (R5, R7, R9, R10) are the focus here, and the serving/identity ones may honestly be "no".' },
]

const SCOUT_SCHEMA = {
  type: 'object',
  properties: {
    domain: { type: 'string' },
    candidates: {
      type: 'array', minItems: 2,
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          cite: { type: 'object', properties: { title:{type:'string'}, venue_year:{type:'string'}, url:{type:'string'} }, required:['title','venue_year','url'] },
          data_regime: { type: 'string' },
          scores: { type: 'object', properties: Object.fromEntries([...Array(10)].map((_,i)=>['R'+(i+1),{type:'string'}])), required: [...Array(10)].map((_,i)=>'R'+(i+1)) },
          evidence: { type: 'string' },
          gaps: { type: 'string' },
        },
        required: ['name','cite','data_regime','scores','evidence','gaps'],
      },
    },
    domain_verdict: { type: 'string' },
  },
  required: ['domain','candidates','domain_verdict'],
}

phase('Scout')
const scouted = (await parallel(DOMAINS.map(d => () =>
  agent(SPEC + '\n\n' + d.prompt + '\n\nReturn structured output; domain="' + d.key + '". Score format per requirement: "yes|partial|no|unknown — <one line why>".',
    { label: 'scout:' + d.key, phase: 'Scout', model: 'opus', schema: SCOUT_SCHEMA })
))).filter(Boolean)
log(scouted.length + '/6 domains scouted, ' + scouted.reduce((n,s)=>n+s.candidates.length,0) + ' candidate systems')

const EVIDENCE = JSON.stringify(scouted)

const JUDGE_SCHEMA = {
  type: 'object',
  properties: {
    matrix: { type: 'array', items: { type: 'object', properties: {
      system: { type:'string' }, domain: { type:'string' },
      yes_count: { type:'integer' }, partial_count: { type:'integer' },
      strongest: { type:'string' }, fatal_gaps: { type:'string' } },
      required: ['system','domain','yes_count','partial_count','strongest','fatal_gaps'] } },
    solved_verdict: { type: 'string', enum: ['SOLVED','MOSTLY-SOLVED-COMPOSABLE','COMPONENTS-ONLY','OPEN'] },
    verdict_rationale: { type: 'string' },
    best_single_system: { type: 'string' },
    unsolved_requirements: { type: 'array', items: { type: 'string' } },
    composite_recipe: { type: 'string' },
    steals: { type: 'array', minItems: 3, items: { type: 'object', properties: {
      what: { type:'string' }, from: { type:'string' }, maps_to: { type:'string' } },
      required: ['what','from','maps_to'] } },
  },
  required: ['matrix','solved_verdict','verdict_rationale','best_single_system','unsolved_requirements','composite_recipe','steals'],
}

phase('Judge')
const judge = await agent(
`You are an adversarial judge. Setting: ` + SPEC + `\n\nSCOUT EVIDENCE (6 domains):\n` + EVIDENCE + `\n\nTASKS:
1. MATRIX: for each credible candidate system (drop weak ones, keep ~8-12), count yes/partial across R1-R10, name its strongest contribution and its fatal gaps FOR OUR SPEC (nightly rebuild window, corpus scale, 5k label budget, eval leakage). Be adversarial about inflated scout scores — downgrade anything whose evidence line does not actually support the score.
2. VERDICT: is the combined spec SOLVED anywhere (one system, >=8 yes), MOSTLY-SOLVED-COMPOSABLE (every requirement has a strong precedent somewhere and the composition is engineering), COMPONENTS-ONLY (some requirements have no strong precedent anywhere), or OPEN? Name which requirements remain without strong precedent in ANY domain.
3. COMPOSITE RECIPE: if not solved by one system, write the best composite — which system supplies which requirement — as one paragraph.
4. STEALS: >=5 concrete, immediately-usable ideas (mechanism + source system + what it maps to in our pipeline).`,
  { label: 'judge:matrix', phase: 'Judge', effort: 'high', schema: JUDGE_SCHEMA })

if (!judge) { log('judge failed'); return { scouted: scouted.length, judge: null, evidence: scouted } }

phase('Synthesize')
const synth = await agent(
`Write a markdown research report (return it as TEXT — do NOT attempt to write any file). Title: "Integrated precedent fan-out — is the combined retrieval spec already solved?" Sections: ## Question and spec (R1-R10, one line each); ## Verdict (the judge's solved_verdict + rationale); ## Candidate matrix (markdown table: system | domain | yes | partial | strongest | fatal gaps); ## Unsolved requirements (bullets); ## Composite recipe (paragraph); ## Steals (numbered, mechanism -> maps-to); ## Per-domain notes (6 short subsections from scout domain_verdicts + key citations with urls). Keep every citation url from the evidence. Setting recap for context: ` + SPEC + `\n\nJUDGE OUTPUT:\n` + JSON.stringify(judge) + `\n\nSCOUT EVIDENCE:\n` + EVIDENCE,
  { label: 'synthesize:report', phase: 'Synthesize', effort: 'high' })

return { domains: scouted.length, verdict: judge.solved_verdict, rationale: judge.verdict_rationale, best: judge.best_single_system, unsolved: judge.unsolved_requirements, steals: judge.steals, report: synth }
