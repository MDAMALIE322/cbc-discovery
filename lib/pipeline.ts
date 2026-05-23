/**
 * CBC GenAI Discovery Assistant — Pipeline
 * Mirrors the Colab notebook: triage → hybrid retrieval → editorial rerank
 * → grounded generation → CEAIRF runtime audit.
 *
 * Governed under CEAIRF v1.0 (Damalie, 2026 — SSRN preprint).
 */
import Anthropic from "@anthropic-ai/sdk";
import { ARTICLES, Article } from "@/data/articles";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ---------- Types ----------
export type Chunk = {
  chunkId: string;
  docId: number;
  title: string;
  date: string;
  text: string;
};
export type Lane = "ANSWER" | "CLARIFY" | "REFUSE";
export type CEAIRFReport = {
  layer1: number;
  layer3: number;
  aggregate: number;
  gate: "Deploy" | "Mitigate" | "Redesign" | "Do Not Deploy";
};
export type PipelineResult = {
  lane: Lane;
  text: string;
  sources: { docId: number; title: string; date: string }[];
  ceairf: CEAIRFReport | null;
  reason: string | null;
  contestId: string;
};

// ---------- Chunking ----------
function chunkArticles(articles: Article[]): Chunk[] {
  const out: Chunk[] = [];
  for (const a of articles) {
    const sents = a.content.split(/(?<=[.!?])\s+/).filter((s) => s.trim());
    sents.forEach((s, i) =>
      out.push({
        chunkId: `a${String(a.id).padStart(3, "0")}_s${i}`,
        docId: a.id,
        title: a.title,
        date: a.date,
        text: s.trim(),
      })
    );
  }
  return out;
}
const CHUNKS = chunkArticles(ARTICLES);

// ---------- Tokenization ----------
function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9]+/g) ?? []);
}

// ---------- BM25-ish lexical scoring (k1=1.5, b=0.75) ----------
const AVGDL =
  CHUNKS.reduce((s, c) => s + tokenize(c.text).length, 0) / CHUNKS.length;
const N = CHUNKS.length;
const DF = new Map<string, number>();
for (const c of CHUNKS) {
  const seen = new Set(tokenize(c.text));
  seen.forEach((t) => DF.set(t, (DF.get(t) ?? 0) + 1));
}
function bm25Score(query: string, chunkText: string): number {
  const k1 = 1.5,
    b = 0.75;
  const qTokens = tokenize(query);
  const cTokens = tokenize(chunkText);
  const dl = cTokens.length || 1;
  const tf = new Map<string, number>();
  cTokens.forEach((t) => tf.set(t, (tf.get(t) ?? 0) + 1));
  let score = 0;
  for (const qt of qTokens) {
    const df = DF.get(qt) ?? 0;
    if (df === 0) continue;
    const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
    const f = tf.get(qt) ?? 0;
    score += idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * dl) / AVGDL)));
  }
  return score;
}

// ---------- Semantic-ish: TF-IDF cosine over unigrams+bigrams ----------
function ngrams(tokens: string[], n: number): string[] {
  const out: string[] = [];
  for (let i = 0; i <= tokens.length - n; i++) out.push(tokens.slice(i, i + n).join(" "));
  return out;
}
function vectorize(text: string): Map<string, number> {
  const toks = tokenize(text);
  const grams = [...ngrams(toks, 1), ...ngrams(toks, 2)];
  const tf = new Map<string, number>();
  grams.forEach((g) => tf.set(g, (tf.get(g) ?? 0) + 1));
  return tf;
}
const CHUNK_VECS = CHUNKS.map((c) => vectorize(c.text));
function cosine(a: Map<string, number>, b: Map<string, number>): number {
  let dot = 0,
    na = 0,
    nb = 0;
  a.forEach((v) => (na += v * v));
  b.forEach((v) => (nb += v * v));
  a.forEach((v, k) => {
    const bv = b.get(k);
    if (bv) dot += v * bv;
  });
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

// ---------- Reciprocal Rank Fusion ----------
function rrf(rankings: number[][], k = 60): { idx: number; score: number }[] {
  const scores = new Map<number, number>();
  for (const r of rankings) {
    r.forEach((idx, rank) =>
      scores.set(idx, (scores.get(idx) ?? 0) + 1 / (k + rank))
    );
  }
  return [...scores.entries()]
    .map(([idx, score]) => ({ idx, score }))
    .sort((a, b) => b.score - a.score);
}

export function hybridRetrieve(query: string, topK = 8) {
  const bm25Scored = CHUNKS.map((c, i) => ({ i, s: bm25Score(query, c.text) }));
  bm25Scored.sort((a, b) => b.s - a.s);
  const bm25Rank = bm25Scored.slice(0, 50).map((x) => x.i);

  const qVec = vectorize(query);
  const semScored = CHUNK_VECS.map((cv, i) => ({ i, s: cosine(qVec, cv) }));
  semScored.sort((a, b) => b.s - a.s);
  const semRank = semScored.slice(0, 50).map((x) => x.i);

  const fused = rrf([bm25Rank, semRank]);
  return fused.slice(0, topK).map(({ idx, score }) => ({
    chunk: CHUNKS[idx],
    score,
  }));
}

// ---------- Editorial re-rank (recency + diversity) ----------
const CORPUS_MAX_DATE = new Date(
  Math.max(...ARTICLES.map((a) => new Date(a.date).getTime()))
);
function recencyWeight(chunk: Chunk, halfLifeYears = 3): number {
  const yearsOld =
    (CORPUS_MAX_DATE.getTime() - new Date(chunk.date).getTime()) /
    (365.25 * 86400 * 1000);
  return Math.pow(0.5, yearsOld / halfLifeYears);
}
export function editorialRerank(
  candidates: { chunk: Chunk; score: number }[],
  maxPerDoc = 2,
  finalK = 5
) {
  const boosted = candidates.map((c) => ({
    ...c,
    score: c.score * (0.7 + 0.3 * recencyWeight(c.chunk)),
  }));
  boosted.sort((a, b) => b.score - a.score);
  const kept: typeof boosted = [];
  const seen = new Map<number, number>();
  for (const c of boosted) {
    if ((seen.get(c.chunk.docId) ?? 0) < maxPerDoc) {
      kept.push(c);
      seen.set(c.chunk.docId, (seen.get(c.chunk.docId) ?? 0) + 1);
    }
    if (kept.length >= finalK) break;
  }
  return kept;
}

// ---------- Triage via Claude Haiku ----------
const TRIAGE_PROMPT = `You are a query classifier for CBC News\'s discovery assistant.

Classify the user\'s query into exactly one lane:
- ANSWER: A factual or discovery question groundable in CBC reporting.
- CLARIFY: Too broad/ambiguous to retrieve against.
- REFUSE: Out of scope. Categories: opinion_or_advocacy, prediction, medical_legal_advice, private_individual, harmful.

Respond ONLY with JSON:
{"lane": "ANSWER" | "CLARIFY" | "REFUSE", "reason": "<short reason or empty>"}

Query: `;

function stripCodeFence(s: string): string {
  return s.replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
}

export async function triage(
  query: string
): Promise<{ lane: Lane; reason: string }> {
  const msg = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 120,
    messages: [{ role: "user", content: TRIAGE_PROMPT + query }],
  });
  const raw = stripCodeFence(
    msg.content[0].type === "text" ? msg.content[0].text : ""
  );
  const parsed = JSON.parse(raw);
  return { lane: parsed.lane as Lane, reason: parsed.reason ?? "" };
}

// ---------- Grounded generation via Claude Sonnet ----------
const CITATION_CONTRACT = `You are CBC News\'s discovery assistant. You answer using ONLY the CBC documents provided.

RULES (non-negotiable):
1. Use only the documents below. No outside knowledge.
2. Every factual sentence ends with [source: a###] using the doc_id.
3. If a needed claim is not in the documents, omit it.
4. Preserve speaker attribution on quotes. Never reassign.
5. Neutral framing. Report; do not opine, advocate, or speculate.
6. Where documents disagree, present both with attribution.
7. If you cannot meet these rules, return: {"refuse": true, "reason": "<short>"}

Otherwise respond with:
{"refuse": false, "answer": "<2-5 sentences with inline [source: a###] citations>"}

CBC DOCUMENTS:
`;

export async function generateGrounded(
  query: string,
  top: { chunk: Chunk; score: number }[]
): Promise<{ refuse: boolean; answer?: string; reason?: string }> {
  const docs = top
    .map(
      ({ chunk: c }) =>
        `[a${String(c.docId).padStart(3, "0")}] (${c.date}) ${c.title}\n${c.text}`
    )
    .join("\n\n");
  const prompt = `${CITATION_CONTRACT}${docs}\n\nUSER QUESTION: ${query}`;
  const msg = await client.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 600,
    messages: [{ role: "user", content: prompt }],
  });
  const raw = stripCodeFence(
    msg.content[0].type === "text" ? msg.content[0].text : ""
  );
  return JSON.parse(raw);
}

// ---------- CEAIRF runtime audit (Layer 1 + Layer 3) ----------
export function ceairfAudit(
  query: string,
  answerText: string,
  top: { chunk: Chunk; score: number }[]
): CEAIRFReport {
  const chunkByDoc = new Map(top.map((t) => [t.chunk.docId, t.chunk]));
  const sentences = answerText.split(/(?<=[.!?])\s+/);
  const cited = sentences.filter((s) => s.includes("[source:"));

  // 1a. Hallucination — lexical overlap on each cited claim
  const hallucScores: number[] = [];
  for (const s of cited) {
    const m = s.match(/\[source:\s*a(\d+)\]/);
    if (!m) continue;
    const docId = parseInt(m[1], 10);
    const chunk = chunkByDoc.get(docId);
    if (!chunk) {
      hallucScores.push(0);
      continue;
    }
    const ct = new Set((s.toLowerCase().match(/[a-z]+/g) ?? []).filter((t) => t !== "source"));
    const chunkT = new Set(chunk.text.toLowerCase().match(/[a-z]+/g) ?? []);
    const overlap = [...ct].filter((t) => chunkT.has(t)).length / Math.max(ct.size, 1);
    hallucScores.push(Math.min(overlap / 0.3, 1));
  }
  const halluc = (hallucScores.length ? hallucScores.reduce((a, b) => a + b, 0) / hallucScores.length : 0) * 2;

  // 1b. Citation completeness
  const factual = sentences.filter((s) => s.trim() && s.split(/\s+/).length > 3);
  const citeRate = factual.length
    ? factual.filter((s) => s.includes("[source:")).length / factual.length
    : 0;
  const citeScore = citeRate * 2;

  // 1c. Prompt-injection check
  const injection = /(ignore\s+previous|disregard\s+instructions)/i.test(query);
  const injScore = injection ? 0 : 2;

  const layer1 = (halluc + citeScore + injScore) / 3;

  // 3a. Accessibility — avg sentence length proxy
  const wordCounts = sentences.filter((s) => s.trim()).map((s) => s.split(/\s+/).length);
  const avgLen = wordCounts.length ? wordCounts.reduce((a, b) => a + b, 0) / wordCounts.length : 0;
  const accessibility = avgLen <= 25 ? 2 : avgLen <= 35 ? 1 : 0;

  // 3b. Transparency
  const transparency = citeRate >= 0.8 ? 2 : citeRate >= 0.5 ? 1 : 0;

  // 3c. AI-use disclosure — always surfaced at app level
  const disclosure = 2;

  const layer3 = (accessibility + transparency + disclosure) / 3;
  const aggregate = layer1 * 0.55 + layer3 * 0.45;
  const gate: CEAIRFReport["gate"] =
    aggregate >= 1.8 ? "Deploy" : aggregate >= 1.4 ? "Mitigate" : aggregate >= 1.0 ? "Redesign" : "Do Not Deploy";

  return { layer1, layer3, aggregate, gate };
}

// ---------- Full pipeline ----------
const REFUSALS: Record<string, string> = {
  opinion_or_advocacy:
    "I can\'t share opinions or advocate for a position — under CBC\'s editorial standards, this assistant reports rather than takes sides.",
  prediction:
    "I don\'t make predictions about future events. I can summarize what CBC has reported on the topic so you can read it directly.",
  medical_legal_advice:
    "I can\'t give personal medical or legal advice.",
  private_individual:
    "I can\'t help with queries targeting private individuals.",
  harmful: "I can\'t help with that request.",
  query_too_broad:
    "Could you narrow that down? A topic, region, or time period would help me find the right CBC reporting.",
};

function newContestId(): string {
  return "contest-" + Math.random().toString(16).slice(2, 10);
}

export async function answerQuery(query: string): Promise<PipelineResult> {
  const contestId = newContestId();

  const t = await triage(query);
  if (t.lane === "REFUSE") {
    const key = (t.reason || "harmful").split(/[\s—-]/)[0];
    return {
      lane: "REFUSE",
      text: REFUSALS[key] ?? "I\'m not able to help with that.",
      sources: [],
      ceairf: null,
      reason: t.reason,
      contestId,
    };
  }
  if (t.lane === "CLARIFY") {
    return {
      lane: "CLARIFY",
      text: REFUSALS.query_too_broad,
      sources: [],
      ceairf: null,
      reason: t.reason,
      contestId,
    };
  }

  const top = editorialRerank(hybridRetrieve(query, 8), 2, 5);
  if (!top.length) {
    return {
      lane: "REFUSE",
      text: "I couldn\'t find any CBC reporting that matches your question.",
      sources: [],
      ceairf: null,
      reason: "no_results",
      contestId,
    };
  }

  const gen = await generateGrounded(query, top);
  if (gen.refuse) {
    return {
      lane: "REFUSE",
      text: `Generator declined: ${gen.reason ?? "unspecified"}`,
      sources: [],
      ceairf: null,
      reason: gen.reason ?? null,
      contestId,
    };
  }

  const audit = ceairfAudit(query, gen.answer!, top);
  return {
    lane: "ANSWER",
    text: gen.answer!,
    sources: top.map(({ chunk: c }) => ({ docId: c.docId, title: c.title, date: c.date })),
    ceairf: audit,
    reason: null,
    contestId,
  };
}
