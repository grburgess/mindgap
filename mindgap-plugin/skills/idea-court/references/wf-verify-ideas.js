export const meta = {
  name: 'idea-verify-fanout',
  description: 'Proposer + adversarial dual-lens verifiers + synthesis over the 5 synthesized ideas',
  phases: [
    { title: 'Propose', detail: 'steelman + decompose into claims (opus)' },
    { title: 'Verify', detail: 'evidence-fidelity (web) + substrate/failure lenses (opus)' },
    { title: 'Synthesize', detail: 'contribution-graded verdicts (ceiling, high effort)' },
  ],
}

const SUBSTRATE = `OUR MEASURED FACTS AND KNOWN TRAPS (ground truth for feasibility checks; do not read files):
- Retrieval@10 = 0.62 on the internal eval set (n=1200 queries); BM25 baseline = 0.55.
- A cross-encoder reranker adds +4pp but triples p95 latency (180ms -> 540ms).
- Embeddings are recomputed nightly; no streaming index exists.
- TRAP: the eval set shares authors with the training corpus; leakage is suspected but UNQUANTIFIED.
- TRAP: click logs are position-biased and were never debiased.
- In-house assets (claimed - flag if an idea's dependence on one is UNVERIFIED): 3 years of query logs; a human-rated relevance set (~8k pairs); a GPU budget of 200 A100-hours/month.`;

const IDEAS = [
  { id: 'idea-rrf-hybrid',
    title: 'Rank-fusion of lexical and dense retrieval',
    body: `Reciprocal-rank fusion over BM25 and dense retrieval, rather than picking one. Published results show RRF beats either arm when the arms fail on complementary queries. IDEA: fuse the existing BM25 index with the nightly embeddings using RRF(K=60), no retraining, no new index. The fusion weight doubles as an auditable knob for the latency/quality tradeoff.` },
  { id: 'idea-leakage-stratum',
    title: 'Author-disjoint eval stratum',
    body: `The suspected train/eval author overlap makes every reported gain unfalsifiable. IDEA: carve an author-disjoint stratum from the existing eval set and report all metrics stratified. Cheap (metadata only, no new labels) and it gates several other ideas at once by establishing whether the 0.62 baseline is real.` },
  { id: 'idea-debiased-clicks',
    title: 'Position-debiased click supervision',
    body: `Click logs are the largest unused label source but are position-biased. IDEA: apply inverse-propensity weighting estimated from a small randomised-interleaving slice, turning 3 years of logs into training signal. Depends on running one interleaving experiment; unverified whether traffic supports it.` },
  { id: 'idea-query-intent-router',
    title: 'Query-intent routing between the lexical and dense arms',
    body: `Fusing every query identically spends the same latency on queries where one arm already wins outright. IDEA: route by predicted intent — navigational/known-item queries to BM25, exploratory/paraphrastic queries to dense — and fuse only the ambiguous middle. Testable offline on the existing 1200-query eval set with no new labels and no index change. RISK: the intent classifier is trained on the same corpus, so it can inherit the suspected author-overlap leakage and look better than it is.` },
  { id: 'idea-stability-regularized-index',
    title: 'Result-ID stability as a ranked objective',
    body: `Permalinks are a sold feature, yet nothing currently constrains how much the ranking churns across a nightly rebuild. IDEA: measure per-query result-ID churn between consecutive rebuilds, then penalise it directly in the ranker so stability is optimised rather than hoped for. Cheap to measure from two consecutive index snapshots. UNVERIFIED: whether current churn is material at all — if it is near zero the whole idea collapses into a monitoring dashboard.` },
];

const PROP_SCHEMA = { type:'object', properties:{
  idea:{type:'string'},
  claims:{type:'array', minItems:3, maxItems:6, items:{type:'object', properties:{
    id:{type:'string'}, claim:{type:'string'},
    kind:{type:'string', enum:['external-evidence','internal-asset','mechanism-transfer','novelty']},
    check:{type:'string'} }, required:['id','claim','kind','check']}},
  weakest_assumption:{type:'string'},
  cheapest_falsification:{type:'string'},
  steelman:{type:'string'} }, required:['idea','claims','weakest_assumption','cheapest_falsification','steelman'] }

const VER_SCHEMA = { type:'object', properties:{
  idea:{type:'string'}, lens:{type:'string'},
  claim_verdicts:{type:'array', items:{type:'object', properties:{
    id:{type:'string'}, verdict:{type:'string', enum:['SUPPORTED','UNSUPPORTED','CONTRADICTED','UNTESTABLE-INTERNAL']},
    evidence:{type:'string'} }, required:['id','verdict','evidence']}},
  new_failure_modes:{type:'array', items:{type:'string'}},
  overall:{type:'string', enum:['HOLDS','HOLDS-WITH-CAVEATS','WEAKENED','REFUTED']},
  rationale:{type:'string'} }, required:['idea','lens','claim_verdicts','new_failure_modes','overall','rationale'] }

phase('Propose')
const results = await pipeline(
  IDEAS,
  it => agent(`You are the PROPOSER for a research idea at an ML company. Steelman it, then decompose it into 3-6 load-bearing CLAIMS (each tagged: external-evidence = a published system/paper must actually say this, verifiable on the web; internal-asset = depends on an in-house capability; mechanism-transfer = an external mechanism must survive our regime; novelty = 'nobody has published X'). For each claim give the concrete CHECK a verifier should run. Then name the single weakest assumption and the cheapest falsification experiment.\n\n` + SUBSTRATE + `\n\nIDEA (id: ${it.id}):\n${it.body}\n\nReturn structured output with idea="${it.id}".`,
    { label:'propose:'+it.id.slice(5,30), phase:'Propose', model:'opus', schema: PROP_SCHEMA }),
  (prop, it) => {
    if (!prop) return null
    const CLAIMS = JSON.stringify(prop.claims)
    return parallel([
      () => agent(`You are an ADVERSARIAL EVIDENCE-FIDELITY verifier. For each claim below, verify it against PRIMARY sources on the web (WebSearch/WebFetch the actual papers, docs, standards named — e.g. the reciprocal-rank-fusion paper (Cormack et al., SIGIR 2009), the BM25/Robertson-Zaragoza monograph, unbiased learning-to-rank via inverse propensity (Joachims et al., WSDM 2017), cross-encoder reranking papers, interleaving-evaluation papers). Verdict per claim: SUPPORTED (source says this), UNSUPPORTED (source silent/weaker), CONTRADICTED (source says otherwise), UNTESTABLE-INTERNAL (internal-asset claims you cannot check — do NOT penalize these, mark and move on). For novelty claims, run 2-3 searches attempting to find prior art that falsifies the 'unpublished' assertion; report anything found. Grade each claim on its own; the idea's overall verdict reflects whether its CORE mechanism survives, not whether every detail does.\n\nIDEA (${it.id}): ${it.body}\n\nCLAIMS: ${CLAIMS}\n\nlens="evidence-fidelity". Return structured output.`,
        { label:'verify-ev:'+it.id.slice(5,28), phase:'Verify', model:'opus', schema: VER_SCHEMA }),
      () => agent(`You are an ADVERSARIAL SUBSTRATE-FEASIBILITY / FAILURE-MODE verifier. NO file reads; judge strictly against the inlined facts. For each claim: does it survive our measured regime (nightly reindex only, p95 latency ceiling, suspected eval leakage, ~8k rated pairs, 200 A100-hours/month) and does the idea reintroduce any known trap listed above? Actively hunt NEW failure modes (e.g., fusion weights needing a tuning set that does not exist; the author-disjoint stratum being too small to power a comparison; interleaving traffic sign-off never arriving; propensity estimates transferring poorly across query segments; a latency budget consumed before the reranker is reached). Verdict per claim SUPPORTED/UNSUPPORTED/CONTRADICTED/UNTESTABLE-INTERNAL; grade contribution, not sufficiency — an idea is WEAKENED/REFUTED only if a LOAD-BEARING claim fails, not if a flourish does.\n\n` + SUBSTRATE + `\n\nIDEA (${it.id}): ${it.body}\n\nCLAIMS: ${CLAIMS}\n\nlens="substrate-failure". Return structured output.`,
        { label:'verify-sub:'+it.id.slice(5,28), phase:'Verify', model:'opus', schema: VER_SCHEMA }),
    ]).then(vs => ({ id: it.id, prop, verifiers: vs.filter(Boolean) }))
  }
)
const done = results.filter(Boolean)
log(done.length + '/5 ideas through propose+verify')

const SYN_SCHEMA = { type:'object', properties:{
  verdicts:{type:'array', minItems:5, maxItems:5, items:{type:'object', properties:{
    id:{type:'string'},
    verdict:{type:'string', enum:['VERIFIED','VERIFIED-WITH-CAVEATS','WEAKENED','REFUTED']},
    confidence:{type:'number'},
    surviving_core:{type:'string'},
    corrections:{type:'array', items:{type:'string'}},
    open_internal_checks:{type:'array', items:{type:'string'}},
    next_test:{type:'string'} }, required:['id','verdict','confidence','surviving_core','corrections','open_internal_checks','next_test']}},
  cross_idea_notes:{type:'string'},
  ranking:{type:'array', items:{type:'string'}} }, required:['verdicts','cross_idea_notes','ranking'] }

phase('Synthesize')
const syn = await agent(`You are the SYNTHESIS judge. Aggregate proposer + two verifier lenses per idea into one verdict each. Rules: grade CONTRIBUTION, not sufficiency — an idea is REFUTED only if its core mechanism is contradicted; caveats and open internal checks are recorded, not fatal. UNTESTABLE-INTERNAL claims become open_internal_checks. Where the evidence-fidelity lens found prior art against a novelty claim, quote it in corrections. Set a revised confidence (0-1) per idea. Rank the 5 by (verified value / remaining risk) and write cross_idea_notes on interactions (e.g., ideas that share a failing assumption).\n\n` + SUBSTRATE + `\n\nPER-IDEA RESULTS:\n` + JSON.stringify(done),
  { label:'synthesize:verdicts', phase:'Synthesize', effort:'high', schema: SYN_SCHEMA })

return { ideas: done.length, syn }
