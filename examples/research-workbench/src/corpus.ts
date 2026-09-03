// A tiny, self-contained "research library": seven papers across three areas,
// wired into a citation DAG. Everything the workbench demonstrates is seeded
// from this spec — note bodies, attachment full-text, SKOS concept tags,
// citation edges, and W3C PROV-shaped provenance attributes — so the app needs
// no server and downloads nothing.
//
// `cites` lists the KEYS of earlier papers each paper references. `concepts` are
// cross-cutting method tags (in addition to the paper's area, which is always a
// concept). `body` is the "full text" attached to the note as extracted text.

export type Area = 'retrieval' | 'reasoning' | 'agents'

export interface Paper {
  key: string
  title: string
  authors: string
  year: number
  area: Area
  /** Short abstract — becomes the note's content. */
  abstract: string
  /** "Full paper text" — attached to the note as an extracted-text attachment. */
  body: string
  /** Cross-cutting method concepts, beyond the area concept. */
  concepts: string[]
  /** Keys of papers this one cites. */
  cites: string[]
  /** Source and agent metadata persisted into provenance_edge attributes. */
  provenance: PaperProvenance
}

export interface PaperProvenance {
  entity: string
  activity: 'prov:Ingest' | 'prov:Derive' | 'prov:Generate'
  agent: string
  derivedFrom: string
  generatedAt: string
  confidence: 'source' | 'reviewed'
  location: string
}

export const AREA_LABEL: Record<Area, string> = {
  retrieval: 'Retrieval',
  reasoning: 'Reasoning',
  agents: 'Agents',
}

export const PAPERS: Paper[] = [
  {
    key: 'dpr',
    title: 'Dense Passage Retrieval',
    authors: 'Karpukhin et al.',
    year: 2020,
    area: 'retrieval',
    abstract:
      'Learns a dual-encoder over questions and passages so relevance becomes an inner product, replacing sparse BM25 lookups with a single nearest-neighbour search.',
    body:
      'Dense Passage Retrieval (DPR) trains two BERT encoders — one for questions, one for passages — with an in-batch-negatives contrastive objective. At query time a passage is relevant when its embedding sits near the question embedding under dot product, so retrieval reduces to approximate nearest-neighbour search over a precomputed passage index. On open-domain QA benchmarks DPR beats a strong BM25 baseline by a wide top-20 margin, and the gap widens as the corpus grows. The paper argues the win comes from learned semantic matching rather than lexical overlap, which is exactly what breaks BM25 on paraphrased questions.',
    concepts: ['embeddings', 'contrastive-learning'],
    cites: [],
    provenance: {
      entity: 'paper:dpr',
      activity: 'prov:Ingest',
      agent: 'demo:corpus-curator',
      derivedFrom: 'doi:10.48550/arXiv.2004.04906',
      generatedAt: '2026-07-17T12:00:00Z',
      confidence: 'reviewed',
      location: 'examples/research-workbench/src/corpus.ts',
    },
  },
  {
    key: 'colbert',
    title: 'ColBERT: Late Interaction Retrieval',
    authors: 'Khattab & Zaharia',
    year: 2020,
    area: 'retrieval',
    abstract:
      'Keeps a per-token embedding for every passage and scores with a cheap MaxSim late-interaction, recovering much of cross-encoder accuracy at retrieval-time cost.',
    body:
      'ColBERT sits between the two extremes of retrieval. A bi-encoder like DPR collapses a passage to one vector — fast but lossy. A cross-encoder scores the full query-passage pair — accurate but O(corpus) at query time. ColBERT keeps one embedding per token and defines relevance as the sum over query tokens of the maximum similarity to any passage token (MaxSim). This "late interaction" is expressive enough to rival cross-encoders yet cheap enough to precompute passage embeddings offline and prune with a vector index. The trade is storage: many vectors per passage instead of one.',
    concepts: ['embeddings', 'late-interaction'],
    cites: ['dpr'],
    provenance: {
      entity: 'paper:colbert',
      activity: 'prov:Derive',
      agent: 'demo:retrieval-reviewer',
      derivedFrom: 'doi:10.48550/arXiv.2004.12832',
      generatedAt: '2026-07-17T12:03:00Z',
      confidence: 'reviewed',
      location: 'examples/research-workbench/src/corpus.ts',
    },
  },
  {
    key: 'rag',
    title: 'Retrieval-Augmented Generation',
    authors: 'Lewis et al.',
    year: 2020,
    area: 'retrieval',
    abstract:
      'Conditions a generator on passages fetched by a differentiable retriever, so factual knowledge lives in an external index the model reads at inference instead of in its weights.',
    body:
      'RAG couples a dense retriever to a sequence generator and marginalises the output over the retrieved passages. Because the retriever is differentiable, the whole pipeline trains end-to-end: the generator learns to attend to evidence and the retriever learns which evidence helps. The practical consequence is that knowledge becomes an editable index rather than frozen parameters — update the corpus and the model answers change with no retraining. This is the template every modern grounded-generation stack follows, and it is why retrieval quality (DPR, ColBERT) directly caps answer quality.',
    concepts: ['grounding', 'embeddings'],
    cites: ['dpr', 'colbert'],
    provenance: {
      entity: 'paper:rag',
      activity: 'prov:Derive',
      agent: 'demo:grounding-reviewer',
      derivedFrom: 'doi:10.48550/arXiv.2005.11401',
      generatedAt: '2026-07-17T12:06:00Z',
      confidence: 'reviewed',
      location: 'examples/research-workbench/src/corpus.ts',
    },
  },
  {
    key: 'cot',
    title: 'Chain-of-Thought Prompting',
    authors: 'Wei et al.',
    year: 2022,
    area: 'reasoning',
    abstract:
      'Shows that prompting a large model to emit intermediate reasoning steps before its answer unlocks multi-step arithmetic and symbolic reasoning that direct-answer prompting misses.',
    body:
      'Chain-of-Thought (CoT) prompting adds a few exemplars whose answers are worked out step by step. The model, primed to imitate that format, decomposes a hard problem into a sequence of smaller inferences and reaches the answer through them. The effect is emergent — it appears only past a scale threshold — and it is largest on arithmetic, commonsense, and symbolic tasks where a single forward pass has to juggle too much at once. CoT reframed prompting as programming the model with a reasoning procedure, not just a question.',
    concepts: ['prompting', 'emergence'],
    cites: [],
    provenance: {
      entity: 'paper:cot',
      activity: 'prov:Ingest',
      agent: 'demo:reasoning-curator',
      derivedFrom: 'doi:10.48550/arXiv.2201.11903',
      generatedAt: '2026-07-17T12:09:00Z',
      confidence: 'reviewed',
      location: 'examples/research-workbench/src/corpus.ts',
    },
  },
  {
    key: 'react',
    title: 'ReAct: Reasoning + Acting',
    authors: 'Yao et al.',
    year: 2022,
    area: 'reasoning',
    abstract:
      'Interleaves chain-of-thought reasoning with tool actions and observations, letting a model plan, act, read the result, and revise — grounding reasoning in a live environment.',
    body:
      'ReAct alternates two token types: thoughts (free-form reasoning, in the CoT spirit) and actions (calls to a tool or environment) whose observations are fed back into context. The reasoning trace decides what to do next; the observation corrects the reasoning when it is wrong. On knowledge-intensive tasks this beats reason-only prompting because the model can look things up instead of hallucinating, and it beats act-only agents because a thought explains and repairs each step. ReAct is the reasoning substrate most tool-using agents are built on.',
    concepts: ['prompting', 'tool-use'],
    cites: ['cot'],
    provenance: {
      entity: 'paper:react',
      activity: 'prov:Derive',
      agent: 'demo:agent-systems-reviewer',
      derivedFrom: 'doi:10.48550/arXiv.2210.03629',
      generatedAt: '2026-07-17T12:12:00Z',
      confidence: 'reviewed',
      location: 'examples/research-workbench/src/corpus.ts',
    },
  },
  {
    key: 'toolformer',
    title: 'Toolformer',
    authors: 'Schick et al.',
    year: 2023,
    area: 'agents',
    abstract:
      'Teaches a model to decide when and how to call external APIs by self-supervising on inserted tool calls that measurably reduce next-token loss, keeping only the useful ones.',
    body:
      'Toolformer bootstraps tool use without human annotation. It samples candidate API calls (calculator, search, calendar) at many positions in ordinary text, executes them, and keeps a call only when its result lowers the loss on the following tokens. Fine-tuning on this filtered data yields a model that inserts the right call at the right moment during normal generation. The lesson generalises the ReAct idea: rather than prompting a frozen model to act, train the acting behaviour in — the model itself learns which tool repays its cost.',
    concepts: ['tool-use', 'self-supervision'],
    cites: ['react'],
    provenance: {
      entity: 'paper:toolformer',
      activity: 'prov:Generate',
      agent: 'demo:tool-use-curator',
      derivedFrom: 'doi:10.48550/arXiv.2302.04761',
      generatedAt: '2026-07-17T12:15:00Z',
      confidence: 'source',
      location: 'examples/research-workbench/src/corpus.ts',
    },
  },
  {
    key: 'agentsurvey',
    title: 'A Survey of Autonomous LLM Agents',
    authors: 'Wang et al.',
    year: 2024,
    area: 'agents',
    abstract:
      'Frames the emerging agent stack — reasoning, tool use, memory, and grounded retrieval — as one architecture, and maps how retrieval, chain-of-thought, and acting compose.',
    body:
      'This survey organises the fast-moving agent literature into four pillars: a reasoning core (CoT and its descendants), an action interface (tools and environments, à la ReAct and Toolformer), a memory layer, and a retrieval/grounding layer (RAG-style external knowledge). Its argument is that these are not competing methods but layers of one architecture — an agent reasons, acts, remembers, and retrieves in a loop — and that most published systems are particular wirings of the same four boxes. It cites work across all three areas in this library, which is why it sits at the sink of the citation graph.',
    concepts: ['grounding', 'tool-use', 'survey'],
    cites: ['rag', 'react', 'toolformer'],
    provenance: {
      entity: 'paper:agentsurvey',
      activity: 'prov:Derive',
      agent: 'demo:survey-curator',
      derivedFrom: 'doi:10.48550/arXiv.2308.11432',
      generatedAt: '2026-07-17T12:18:00Z',
      confidence: 'source',
      location: 'examples/research-workbench/src/corpus.ts',
    },
  },
]
