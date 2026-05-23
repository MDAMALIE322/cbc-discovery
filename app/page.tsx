"use client";

import { useState, useRef, useEffect } from "react";

type CEAIRFReport = {
  layer1: number;
  layer3: number;
  aggregate: number;
  gate: "Deploy" | "Mitigate" | "Redesign" | "Do Not Deploy";
};
type Source = { docId: number; title: string; date: string };
type AssistantMessage = {
  role: "assistant";
  lane: "ANSWER" | "CLARIFY" | "REFUSE";
  text: string;
  sources: Source[];
  ceairf: CEAIRFReport | null;
  reason: string | null;
  contestId: string;
};
type UserMessage = { role: "user"; text: string };
type Message = UserMessage | AssistantMessage;

const SAMPLES = [
  "What has CBC reported about rent control and housing affordability?",
  "Should I support stricter rent control? What do you think?",
  "Will housing prices crash next year?",
  "What are the different perspectives on rent control?",
];

function gateColor(gate: string) {
  if (gate === "Deploy") return "bg-emerald-100 text-emerald-800 border-emerald-300";
  if (gate === "Mitigate") return "bg-amber-100 text-amber-800 border-amber-300";
  if (gate === "Redesign") return "bg-orange-100 text-orange-800 border-orange-300";
  return "bg-red-100 text-red-800 border-red-300";
}

function laneColor(lane: string) {
  if (lane === "ANSWER") return "bg-emerald-600 text-white";
  if (lane === "CLARIFY") return "bg-amber-600 text-white";
  return "bg-cbc-red text-white";
}

// Highlight [source: a###] citations in red
function renderText(text: string) {
  const parts = text.split(/(\[source:\s*a\d+\])/g);
  return parts.map((p, i) =>
    /\[source:\s*a\d+\]/.test(p) ? (
      <span key={i} className="text-cbc-red font-semibold">{p}</span>
    ) : (
      <span key={i}>{p}</span>
    )
  );
}

export default function Home() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [showAudit, setShowAudit] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading]);

  async function send(text: string) {
    if (!text.trim() || loading) return;
    const userMsg: UserMessage = { role: "user", text };
    setMessages((m) => [...m, userMsg]);
    setInput("");
    setLoading(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: text }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? "Request failed");
      }
      const data = await res.json();
      const assistantMsg: AssistantMessage = {
        role: "assistant",
        lane: data.lane,
        text: data.text,
        sources: data.sources ?? [],
        ceairf: data.ceairf,
        reason: data.reason,
        contestId: data.contestId,
      };
      setMessages((m) => [...m, assistantMsg]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          lane: "REFUSE",
          text: `Pipeline error: ${msg}`,
          sources: [],
          ceairf: null,
          reason: "error",
          contestId: "—",
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex h-screen">
      {/* Sidebar */}
      <aside className="w-80 bg-white border-r border-cbc-rule flex flex-col">
        <div className="px-5 py-5 border-b border-cbc-rule">
          <div className="flex items-center gap-2 mb-2">
            <span className="inline-block w-3 h-3 bg-cbc-red" />
            <span className="text-[10px] tracking-[0.15em] font-semibold text-cbc-muted uppercase">
              CBC Digital Services
            </span>
          </div>
          <h1 className="text-xl font-bold text-cbc-ink leading-snug">
            GenAI Discovery Assistant
          </h1>
          
        </div>

        <div className="px-5 py-4 border-b border-cbc-rule">
          <p className="text-[10px] tracking-[0.15em] font-semibold text-cbc-muted uppercase mb-3">
            Try a sample query
          </p>
          <div className="space-y-2">
            {SAMPLES.map((q) => (
              <button
                key={q}
                onClick={() => send(q)}
                disabled={loading}
                className="w-full text-left text-xs leading-snug px-3 py-2.5 bg-cbc-paper hover:bg-white border border-cbc-rule hover:border-cbc-red rounded transition-colors disabled:opacity-50"
              >
                {q}
              </button>
            ))}
          </div>
        </div>

        <div className="px-5 py-4 border-b border-cbc-rule">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={showAudit}
              onChange={(e) => setShowAudit(e.target.checked)}
              className="accent-cbc-red"
            />
            <span className="text-xs text-cbc-ink">Operator view (CEAIRF scores)</span>
          </label>
        </div>

        <div className="mt-auto px-5 py-4 text-[10px] text-cbc-muted leading-relaxed">
          <p>CBC AI can make mistakes. Please double-check responses.</p>
        </div>
      </aside>

      {/* Main chat */}
      <main className="flex-1 flex flex-col">
        {/* Top bar */}
        <header className="px-8 py-4 border-b border-cbc-rule bg-white">
          <div className="flex items-baseline justify-between">
            <div>
              <h2 className="text-lg font-bold text-cbc-ink">Discovery</h2>
              <p className="text-xs text-cbc-muted">Ask about CBC reporting in plain language</p>
            </div>
            
          </div>
        </header>

        {/* Messages */}
        <div ref={scrollRef} className="chat-scroll flex-1 overflow-y-auto px-8 py-6 space-y-6">
          {messages.length === 0 && (
            <div className="text-center py-20">
              <div className="inline-block w-12 h-12 bg-cbc-red mb-4" />
              <p className="text-cbc-muted">Pick a sample query, or type your own below.</p>
            </div>
          )}

          {messages.map((m, i) =>
            m.role === "user" ? (
              <div key={i} className="flex justify-end">
                <div className="max-w-2xl bg-cbc-navy text-white px-5 py-3 rounded-lg">
                  {m.text}
                </div>
              </div>
            ) : (
              <div key={i} className="max-w-3xl">
                {/* Lane badge */}
                <div className="flex items-center gap-2 mb-2">
                  <span className={`text-[10px] tracking-[0.15em] font-bold px-2 py-0.5 ${laneColor(m.lane)}`}>
                    {m.lane}
                  </span>
                  {m.reason && (
                    <span className="text-xs italic text-cbc-muted">{m.reason}</span>
                  )}
                </div>

                {/* Response text */}
                <div className="bg-white border border-cbc-rule rounded-lg px-6 py-5 leading-relaxed text-cbc-ink">
                  {renderText(m.text)}
                </div>

                {/* Sources */}
                {m.sources.length > 0 && (
                  <div className="mt-3 px-6 py-4 bg-cbc-paper border border-cbc-rule rounded-lg">
                    <p className="text-[10px] tracking-[0.15em] font-semibold text-cbc-navy uppercase mb-2">
                      Sources
                    </p>
                    <ul className="space-y-1.5">
                      {m.sources.map((s) => (
                        <li key={s.docId} className="text-xs text-cbc-ink">
                          <span className="font-mono font-semibold text-cbc-red mr-2">
                            a{String(s.docId).padStart(3, "0")}
                          </span>
                          {s.title}{" "}
                          <span className="text-cbc-muted">({s.date})</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* CEAIRF audit */}
                {showAudit && m.ceairf && (
                  <div className="mt-3 px-6 py-4 bg-cbc-navy text-white rounded-lg">
                    <p className="text-[10px] tracking-[0.15em] font-semibold text-cbc-red uppercase mb-3">
                      CEAIRF Runtime Audit — Operator View
                    </p>
                    <div className="grid grid-cols-4 gap-4 text-center">
                      <div>
                        <p className="text-[10px] uppercase tracking-wider text-blue-200">Layer 1 · Tech</p>
                        <p className="text-2xl font-bold mt-1">{m.ceairf.layer1.toFixed(2)}</p>
                      </div>
                      <div>
                        <p className="text-[10px] uppercase tracking-wider text-blue-200">Layer 3 · Reg</p>
                        <p className="text-2xl font-bold mt-1">{m.ceairf.layer3.toFixed(2)}</p>
                      </div>
                      <div>
                        <p className="text-[10px] uppercase tracking-wider text-blue-200">Aggregate</p>
                        <p className="text-2xl font-bold mt-1">{m.ceairf.aggregate.toFixed(2)}</p>
                      </div>
                      <div>
                        <p className="text-[10px] uppercase tracking-wider text-blue-200">Gate</p>
                        <span className={`inline-block mt-1 px-2 py-1 text-xs font-bold border ${gateColor(m.ceairf.gate)}`}>
                          {m.ceairf.gate}
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                {/* contest_id */}
                <p className="mt-2 text-[10px] text-cbc-muted font-mono">
                  contest_id: {m.contestId}
                </p>
              </div>
            )
          )}

          {loading && (
            <div className="max-w-3xl">
              <div className="bg-white border border-cbc-rule rounded-lg px-6 py-5">
                <div className="flex items-center gap-2 text-cbc-muted text-sm">
                  <div className="w-2 h-2 bg-cbc-red rounded-full animate-pulse" />
                  <span>Running pipeline — triage, retrieval, audit…</span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Input */}
        <div className="border-t border-cbc-rule bg-white px-8 py-4">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              send(input);
            }}
            className="flex gap-3 max-w-3xl"
          >
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask about CBC reporting…"
              disabled={loading}
              className="flex-1 px-4 py-3 border border-cbc-rule rounded-lg focus:outline-none focus:border-cbc-red disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={loading || !input.trim()}
              className="px-6 py-3 bg-cbc-red text-white font-semibold rounded-lg hover:bg-red-700 disabled:opacity-50 transition-colors"
            >
              Send
            </button>
          </form>
        </div>
      </main>
    </div>
  );
}
