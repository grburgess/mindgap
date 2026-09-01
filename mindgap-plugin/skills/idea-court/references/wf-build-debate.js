export const meta = {
  name: 'first-model-debate',
  description: 'What model to build first: 4 advocates + cross-examination + claim verifier + judge',
  phases: [
    { title: 'Advocate', detail: '4 model champions (opus)' },
    { title: 'Rebut', detail: 'cross-examination (opus)' },
    { title: 'Verify', detail: 'claim audit vs evidence base (ceiling)' },
    { title: 'Judge', detail: 'ruling + sequencing (ceiling, high)' },
  ],
}

const EVIDENCE = `EVIDENCE BASE (all verified in-house; cite honestly, the verifier will audit):
SUBSTRATE: 12M-document corpus, nightly full reindex; BM25 baseline retrieval@10 = 0.55; dense (frozen encoder) = 0.58; naive 50/50 score blend = 0.56 (RED — score scales differ); RRF(K=60) on a 200-query pilot = 0.66 (GREEN). Cross-encoder rerank +4pp but p95 180ms -> 540ms. Human budget 5k relevance judgements TOTAL.
SURVEY VERDICT (verifier-passed): architecture B rank-fusion > D learned-sparse > A dense-only > C (graph-expansion, contraindicated). B's success bar: >=+3pp retrieval@10 vs BM25; p95 <=250ms; no regression on the author-disjoint stratum; rebuild <=1 nightly cycle; <=5k labels.
KEY CAVEAT: the eval set shares authors with the training corpus; gains may be leakage. Only the author-disjoint stratum decorrelates this.
NEW MEASUREMENT: 3 years of click logs, ~40M events, position-biased and never debiased; a randomised-interleaving slice would cost ~1% of traffic for 2 weeks.
IDEA VERDICTS (adversarial proposer/verifier pass): (a) RRF hybrid VERIFIED-WITH-CAVEATS conf 0.6 — novelty demolished (RRF is 2009) but the surviving core is that our two arms fail on complementary queries, unmeasured; (b) author-disjoint stratum VERIFIED conf 0.8 — cheap, metadata-only, gates every other number; (c) debiased clicks WEAKENED conf 0.3 — survivor is the interleaving slice itself, an UNTESTABLE-INTERNAL until traffic sign-off.
PRODUCT CONTEXT: irrelevant top-3 results are the #1 user complaint; result IDs must stay stable across rebuilds (permalinks are a sold feature); the nightly rebuild window is FROZEN for this effort.`

const CANDIDATES = [
 { key: 'rrf-fusion', name: 'R1 · Reciprocal-rank fusion over the existing two arms',
   brief: 'Fuse the existing BM25 and dense arms with RRF(K=60) first: no retraining, no new index, one auditable knob. Directly attacks the #1 user complaint (irrelevant top-3) and the survey success bar, and the 200-query pilot at 0.66 says the arms already fail on complementary queries.' },
 { key: 'rerank-top50', name: 'R2 · Cross-encoder rerank of top-50 only (latency-capped)',
   brief: 'Build the reranker first, capped at top-50 so the latency budget holds: +4pp is the largest single measured gain available, it is independent of which first-stage retriever wins, and its training consumes the 8k rated pairs already in hand rather than new labels.' },
 { key: 'debias-clicks', name: 'R3 · Interleaving-estimated propensities over the click logs',
   brief: 'Build the supervision source first: run one randomised-interleaving slice (~1% traffic, 2 weeks), estimate position propensities, and turn 3 years of logs into training signal. Every later model is label-starved without it; the labels are free once the experiment lands.' },
 { key: 'null', name: 'R0 · Build nothing; measure the author-disjoint stratum first',
   brief: 'Build zero models now. Carve the author-disjoint eval stratum from metadata alone and re-measure every baseline on it. If the 0.62 is leakage, every ranking above is optimising a fiction. Measurement is days; a model trained against a contaminated number is months.' },
]

const CASE_SCHEMA = { type:'object', properties:{
  key:{type:'string'}, case_for:{type:'string'},
  unblocks:{type:'array',items:{type:'string'}},
  cost_estimate:{type:'string'}, biggest_risk:{type:'string'},
  kill_condition:{type:'string'},
  evidence_cited:{type:'array',items:{type:'string'}} },
  required:['key','case_for','unblocks','cost_estimate','biggest_risk','kill_condition','evidence_cited'] }

const REBUT_SCHEMA = { type:'object', properties:{
  key:{type:'string'},
  attacks:{type:'array',minItems:3,maxItems:3,items:{type:'object',properties:{
    target:{type:'string'}, attack:{type:'string'}, evidence:{type:'string'} },
    required:['target','attack','evidence']}},
  concession:{type:'string'},
  final_position:{type:'string'} },
  required:['key','attacks','concession','final_position'] }

phase('Advocate')
const cases = (await parallel(CANDIDATES.map(c => () =>
  agent(`You are the ADVOCATE for building this model FIRST at an ML company. Make the strongest honest case grounded ONLY in the evidence base — a claim verifier will audit every factual assertion, and fabricated or miscited numbers lose the debate. Include: what building it FIRST unblocks that the others cannot, cost (labels, compute, calendar), the biggest real risk, and an honest kill condition.\n\n${EVIDENCE}\n\nYOUR CANDIDATE (${c.key}): ${c.name}\n${c.brief}\n\nReturn structured output with key="${c.key}".`,
    { label:'advocate:'+c.key, phase:'Advocate', model:'opus', schema: CASE_SCHEMA })
))).filter(Boolean)
log(cases.length + '/4 cases made')
const CASES = JSON.stringify(cases)

phase('Rebut')
const rebuttals = (await parallel(CANDIDATES.map(c => () =>
  agent(`You are the ADVOCATE for ${c.key} in cross-examination. Here are ALL FOUR cases. Attack the three rivals — one attack each, the sharpest evidence-grounded flaw in their FIRST-ness (not their eventual value). Then make one honest concession about your own case, and state your final position (which may propose a pairing/sequencing if the evidence forces it).\n\n${EVIDENCE}\n\nALL CASES:\n${CASES}\n\nReturn structured output with key="${c.key}".`,
    { label:'rebut:'+c.key, phase:'Rebut', model:'opus', schema: REBUT_SCHEMA })
))).filter(Boolean)
log(rebuttals.length + '/4 rebuttals in')

phase('Verify')
const VERIFY_SCHEMA = { type:'object', properties:{
  violations:{type:'array',items:{type:'object',properties:{
    speaker:{type:'string'}, claim:{type:'string'},
    verdict:{type:'string',enum:['MISCITED','FABRICATED','OVERSTATED','UNVERIFIABLE']},
    correction:{type:'string'} }, required:['speaker','claim','verdict','correction']}},
  clean_speakers:{type:'array',items:{type:'string'}},
  material_impact:{type:'string'} }, required:['violations','clean_speakers','material_impact'] }
const audit = await agent(`You are the CLAIM VERIFIER. Audit every factual assertion in the four cases and four rebuttals STRICTLY against the evidence base. Flag: MISCITED (evidence says something different), FABRICATED (no basis), OVERSTATED (directional truth, inflated magnitude). Internal logic and opinions are fine — only factual claims about the evidence are in scope. State which violations materially change the debate.\n\n${EVIDENCE}\n\nCASES:\n${CASES}\n\nREBUTTALS:\n${JSON.stringify(rebuttals)}`,
  { label:'verify:claims', phase:'Verify', effort:'high', schema: VERIFY_SCHEMA })

phase('Judge')
const JUDGE_SCHEMA = { type:'object', properties:{
  ruling:{type:'string'},
  first_model:{type:'string'},
  sequencing:{type:'array',items:{type:'string'}},
  decisive_arguments:{type:'array',items:{type:'string'}},
  rejected_because:{type:'array',items:{type:'object',properties:{
    key:{type:'string'}, reason:{type:'string'}}, required:['key','reason']}},
  conditions:{type:'array',items:{type:'string'}},
  dissent_worth_recording:{type:'string'} },
  required:['ruling','first_model','sequencing','decisive_arguments','rejected_because','conditions','dissent_worth_recording'] }
const ruling = await agent(`You are the JUDGE. Rule on WHAT TO BUILD FIRST. Weigh the cases and rebuttals, discounting any claim the verifier flagged. Judge FIRST-ness: information value, unblocking power, label-budget preservation, trap exposure (eval leakage, position bias, latency regression), and calendar. A hybrid/sequenced ruling is allowed but must name ONE thing to start building Monday morning. Record the strongest dissent.\n\n${EVIDENCE}\n\nCASES:\n${CASES}\n\nREBUTTALS:\n${JSON.stringify(rebuttals)}\n\nCLAIM AUDIT:\n${JSON.stringify(audit)}`,
  { label:'judge:ruling', phase:'Judge', effort:'high', schema: JUDGE_SCHEMA })

return { cases: cases.length, audit_violations: audit ? audit.violations.length : null, ruling }
