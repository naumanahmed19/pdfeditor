import { memo, useCallback, useEffect, useRef, useState } from "react";
import {
  Bot,
  CirclePlus,
  ListChecks,
  ScrollText,
  Send,
  Sparkles,
  Square,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { useAppSelector, shallowEqual } from "../../store";
import { Button } from "../ui/button";
import { Select } from "../ui/select";
import { cn, uid } from "../../lib/utils";
import { extractAllText } from "../../lib/pdf";
import { checkConnection, streamChat } from "../../lib/ai";
import { BROWSER_MODEL_LABEL } from "../../lib/modelConfig";
import type { ChatMessage } from "../../types";

interface UiMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
}

const CHAT_KEY = "pickpdf-chat";

// Sentinel option value that navigates to Settings instead of selecting a model.
const SWITCH_PROVIDER = "__switch_provider__";

function loadChat(): UiMessage[] {
  try {
    return JSON.parse(localStorage.getItem(CHAT_KEY) ?? "[]");
  } catch {
    return [];
  }
}

/**
 * Provider errors often arrive as raw (sometimes doubly-nested) JSON.
 * Dig out the deepest human-readable `message` so the bubble shows a clean
 * sentence instead of a wall of JSON.
 */
function cleanErrorMessage(raw: string): string {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end <= start) return raw.trim();

  let deepest = "";
  const dig = (val: unknown): void => {
    if (typeof val === "string") {
      const t = val.trim();
      if (t.startsWith("{") && t.endsWith("}")) {
        try {
          dig(JSON.parse(t));
          return;
        } catch {
          /* not nested json — treat as text */
        }
      }
      deepest = t;
    } else if (val && typeof val === "object") {
      const o = val as Record<string, unknown>;
      if (o.error !== undefined) dig(o.error);
      else if (typeof o.message === "string") dig(o.message);
    }
  };

  try {
    dig(JSON.parse(raw.slice(start, end + 1)));
  } catch {
    return raw.trim();
  }
  return deepest || raw.trim();
}

const SELECTION_ACTIONS = [
  ["Explain", "Explain this text simply"],
  ["Rewrite", "Rewrite this text more clearly and professionally"],
  ["Fix grammar", "Fix the grammar and spelling of this text; keep meaning identical"],
  ["Translate to English", "Translate this text to English"],
] as const;

// Memoized: no props, so it ignores parent (Shell) re-renders and only reacts
// to its own selected store fields.
export const AiPanel = memo(AiPanelImpl);

function AiPanelImpl() {
  // Select only the fields the panel uses (no editing-tool state), so it stays
  // insulated from tool/color/selection churn while you edit.
  const app = useAppSelector(
    (s) => ({
      addAnnotation: s.addAnnotation,
      aiAsk: s.aiAsk,
      aiOpen: s.aiOpen,
      askAi: s.askAi,
      currentPage: s.currentPage,
      docName: s.docName,
      fontSize: s.fontSize,
      isMobile: s.isMobile,
      numPages: s.numPages,
      pdf: s.pdf,
      setAiOpen: s.setAiOpen,
      setEditMode: s.setEditMode,
      setScreen: s.setScreen,
      setSettings: s.setSettings,
      setSidebarOpen: s.setSidebarOpen,
      settings: s.settings,
    }),
    shallowEqual,
  );
  const [messages, setMessages] = useState<UiMessage[]>(loadChat);
  const [models, setModels] = useState<string[]>([]);

  // Persist the conversation across reloads (last 40 messages).
  useEffect(() => {
    try {
      localStorage.setItem(CHAT_KEY, JSON.stringify(messages.slice(-40)));
    } catch {
      /* storage full — skip */
    }
  }, [messages]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<"unknown" | "ok" | "error">("unknown");
  const [statusDetail, setStatusDetail] = useState("");
  const [selection, setSelection] = useState("");
  const [selectionPage, setSelectionPage] = useState<number | null>(null);
  const [selectionPos, setSelectionPos] = useState<{ x: number; y: number } | null>(null);
  const [fabMenuOpen, setFabMenuOpen] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Track text selection inside the PDF text layer: text, page and on-screen
  // position (for the floating assistant button).
  useEffect(() => {
    const onSel = () => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed) {
        setSelection("");
        setSelectionPos(null);
        setFabMenuOpen(false);
        return;
      }
      const anchor = sel.anchorNode?.parentElement;
      if (anchor?.closest(".textLayer")) {
        setSelection(sel.toString().trim().slice(0, 4000));
        const pageEl = anchor.closest("[data-page-index]");
        setSelectionPage(
          pageEl ? Number(pageEl.getAttribute("data-page-index")) : null,
        );
        const rect = sel.getRangeAt(0).getBoundingClientRect();
        const visible =
          (rect.width || rect.height) &&
          rect.bottom >= 0 &&
          rect.top <= window.innerHeight;
        setSelectionPos(
          visible
            ? {
                x: Math.min(rect.right + 6, window.innerWidth - 44),
                y: Math.max(8, rect.top - 36),
              }
            : null,
        );
      }
    };
    document.addEventListener("selectionchange", onSel);
    window.addEventListener("scroll", onSel, true);
    window.addEventListener("resize", onSel);
    return () => {
      document.removeEventListener("selectionchange", onSel);
      window.removeEventListener("scroll", onSel, true);
      window.removeEventListener("resize", onSel);
    };
  }, []);

  // Connection check when panel opens or settings change.
  useEffect(() => {
    if (!app.aiOpen) return;
    let alive = true;
    setStatus("unknown");
    checkConnection(app.settings).then((r) => {
      if (!alive) return;
      setStatus(r.ok ? "ok" : "error");
      setModels(r.models);
      setStatusDetail(
        r.ok
          ? `${r.models.length} model(s) available`
          : r.error ?? "Not reachable",
      );
    });
    return () => {
      alive = false;
    };
  }, [app.aiOpen, app.settings]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  const buildContext = useCallback(async (
    userText?: string,
    sel?: { page: number | null; text: string },
  ): Promise<{
    text: string;
    scopedPage: number | null;
  }> => {
    if (!app.pdf) return { text: "", scopedPage: null };
    const pages = await extractAllText(app.pdf);
    const limit = app.settings.contextChars;

    const scopeTo = (idx: number) => {
      const p = pages.find((x) => x.pageIndex === idx);
      return p?.full.trim()
        ? {
            text: `\n--- Page ${idx + 1} ---\n${p.full}`.slice(0, limit),
            scopedPage: idx + 1,
          }
        : null;
    };

    // Selection actions: context is the page the selection lives on. If we
    // didn't record the page, find it by searching the extracted text.
    if (sel) {
      if (sel.page !== null) {
        const s = scopeTo(sel.page);
        if (s) return s;
      }
      const needle = sel.text.slice(0, 80).trim();
      const hit = needle ? pages.find((p) => p.full.includes(needle)) : undefined;
      if (hit) {
        const s = scopeTo(hit.pageIndex);
        if (s) return s;
      }
      // Snippet not found — send no context rather than the whole document.
      return { text: "", scopedPage: null };
    }

    // "…page 3…" in the question → send only that page. Keeps requests small
    // and inside tight model context windows.
    const ref = userText?.match(/\bpage\s+(\d{1,4})\b/i);
    if (ref) {
      const idx = Number(ref[1]) - 1;
      const s = scopeTo(idx);
      if (s) return s;
    }

    let ctx = "";
    // Current page first so it survives truncation.
    const ordered = [
      ...pages.filter((p) => p.pageIndex === app.currentPage),
      ...pages.filter((p) => p.pageIndex !== app.currentPage),
    ];
    for (const p of ordered) {
      const chunk = `\n--- Page ${p.pageIndex + 1} ---\n${p.full}`;
      if (ctx.length + chunk.length > limit) {
        ctx += chunk.slice(0, Math.max(0, limit - ctx.length));
        break;
      }
      ctx += chunk;
    }
    return { text: ctx, scopedPage: null };
  }, [app.pdf, app.currentPage, app.settings.contextChars]);

  const send = useCallback(
    async (
      userText: string,
      opts?: { selection?: { page: number | null; text: string } },
    ) => {
      if (!userText.trim() || busy) return;
      setBusy(true);
      setInput("");
      const userMsg: UiMessage = { id: uid(), role: "user", content: userText };
      const assistantMsg: UiMessage = { id: uid(), role: "assistant", content: "" };
      setMessages((prev) => [...prev, userMsg, assistantMsg]);

      try {
        // If the question references a page, sanity-check it before calling
        // the model — a local answer beats a confused LLM reply. (Skipped for
        // selection actions, where "page N" may just occur in the quote.)
        const pageRef = opts?.selection
          ? null
          : userText.match(/\bpage\s+(\d{1,4})\b/i);
        const answerLocally = (content: string) => {
          setMessages((prev) =>
            prev.map((m) => (m.id === assistantMsg.id ? { ...m, content } : m)),
          );
        };
        if (pageRef && app.pdf) {
          const n = Number(pageRef[1]);
          if (n < 1 || n > app.numPages) {
            answerLocally(
              `This document has ${app.numPages} page${app.numPages === 1 ? "" : "s"} — there is no page ${n}.`,
            );
            return;
          }
        }

        const { text: context, scopedPage } = await buildContext(
          userText,
          opts?.selection,
        );
        if (pageRef && app.pdf && !scopedPage) {
          answerLocally(
            `Page ${Number(pageRef[1])} has no selectable text — it's likely a scanned image. Run Tools → “Make searchable (OCR)” first, then ask again.`,
          );
          return;
        }

        const system = [
          "You are a helpful PDF assistant inside a PDF editor called PickPDF.",
          "Be concise and practical. Answer questions about the document, summarize, rewrite, translate or draft text when asked.",
          "When the user asks you to write or rewrite text that will be inserted into the PDF, output ONLY the text to insert, no preamble.",
          app.docName ? `The open document is "${app.docName}" (${app.numPages} pages). The user is viewing page ${app.currentPage + 1}.` : "No document is open.",
          context
            ? `${scopedPage ? `Content of page ${scopedPage}${opts?.selection ? " — the page containing the user's selected text" : ""} (only this page is included)` : "Document content (may be truncated)"}:\n${context}`
            : "",
        ]
          .filter(Boolean)
          .join("\n\n");

        const history: ChatMessage[] = [
          { role: "system", content: system },
          // Recent turns only — long histories overflow small local models.
          ...messages
            .slice(-8)
            .map((m) => ({ role: m.role, content: m.content }) as ChatMessage),
          { role: "user", content: userText },
        ];

        abortRef.current = new AbortController();
        let streaming = false;
        await streamChat(
          app.settings,
          history,
          (delta) => {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMsg.id
                  ? { ...m, content: (streaming ? m.content : "") + delta }
                  : m,
              ),
            );
            streaming = true;
          },
          abortRef.current.signal,
          // Download / load progress for the in-browser model (before tokens).
          (status) => {
            if (streaming) return;
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMsg.id ? { ...m, content: status } : m,
              ),
            );
          },
        );
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          const raw = err instanceof Error ? err.message : "Request failed";
          const clean = cleanErrorMessage(raw);
          const providerName =
            app.settings.provider === "ollama"
              ? "Ollama"
              : app.settings.provider === "lmstudio"
                ? "LM Studio"
                : "your API";
          let hint = "";
          if (/context (size|window|length)|exceed|too many tokens|n_ctx/i.test(raw)) {
            hint =
              "\n\nThe document is too large for this model's context window. Try asking about one page (e.g. “Summarize page 3”), reduce “Document context” in Settings, or switch to a model with a larger context.";
          } else if (
            app.settings.provider !== "browser" &&
            /fetch|reach|refused|network|econn|load failed|connect/i.test(raw)
          ) {
            hint = `\n\nCheck that ${providerName} is running and the model “${app.settings.model}” is available (Settings).`;
          }
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantMsg.id
                ? { ...m, content: m.content || `⚠️ ${clean}${hint}` }
                : m,
            ),
          );
        }
      } finally {
        setBusy(false);
        abortRef.current = null;
      }
    },
    [busy, messages, buildContext, app.settings, app.docName, app.numPages, app.currentPage],
  );

  // Prompts queued from elsewhere in the app (e.g. the viewer's copilot
  // menu) via app.askAi. Waits for the current generation to finish.
  const handledAskRef = useRef<string | null>(null);
  useEffect(() => {
    if (!app.aiAsk || handledAskRef.current === app.aiAsk.id) return;
    if (busy) return;
    handledAskRef.current = app.aiAsk.id;
    void send(app.aiAsk.prompt);
  }, [app.aiAsk, busy, send]);

  const stop = () => abortRef.current?.abort();

  const insertAsTextBox = (content: string) => {
    if (!app.pdf) {
      toast.error("Open a PDF first");
      return;
    }
    app.addAnnotation(app.currentPage, {
      id: uid(),
      kind: "text",
      x: 60,
      y: 80,
      w: 340,
      h: Math.min(500, content.split("\n").length * app.fontSize * 1.4 + 20),
      text: content,
      fontSize: app.fontSize,
      color: "#111111",
    });
    app.setScreen("viewer");
    app.setEditMode(true);
    toast.success(`Inserted on page ${app.currentPage + 1} — drag to position`);
  };

  const TypingDots = () => (
    <span className="flex items-center gap-1 py-1.5" aria-label="Assistant is typing">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="typing-dot h-1.5 w-1.5 rounded-full bg-muted-foreground/70"
          style={{ animationDelay: `${i * 0.18}s` }}
        />
      ))}
    </span>
  );

  // Floating assistant button next to the current text selection. Click →
  // quick-actions menu that fires immediately (opening the panel if needed).
  const selectionFab = selectionPos && selection && (
    <div
      className="fixed z-50"
      style={{ left: selectionPos.x, top: selectionPos.y }}
      // preventDefault keeps the text selection alive through clicks.
      onMouseDown={(e) => e.preventDefault()}
    >
      <button
        onClick={() => setFabMenuOpen((o) => !o)}
        className="flex h-8 w-8 items-center justify-center rounded-full border border-border bg-background text-primary shadow-md transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        title="Ask AI about this selection"
        aria-label="Ask AI about this selection"
      >
        <Bot className="h-4 w-4" />
      </button>
      {fabMenuOpen && (
        <div
          className={cn(
            "absolute top-9 flex w-44 flex-col rounded-lg border bg-popover p-1 shadow-lg",
            selectionPos.x > window.innerWidth - 200 ? "right-0" : "left-0",
          )}
        >
          {SELECTION_ACTIONS.map(([label, instruction]) => (
            <button
              key={label}
              disabled={busy}
              className="rounded-md px-2 py-1.5 text-left text-xs font-medium transition-colors hover:bg-accent disabled:opacity-50"
              onClick={() => {
                setFabMenuOpen(false);
                app.setAiOpen(true);
                if (app.isMobile) app.setSidebarOpen(false);
                void send(`${instruction}:\n\n"""${selection}"""`, {
                  selection: { page: selectionPage, text: selection },
                });
              }}
            >
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );

  if (!app.aiOpen) return <>{selectionFab}</>;

  const quickActions = [
    {
      icon: ScrollText,
      label: "Summarize",
      prompt: "Summarize this document in a few short paragraphs.",
      needsDoc: true,
    },
    {
      icon: ScrollText,
      label: "Summarize page",
      // Says "page N" so buildContext scopes to just this page — a small
      // prompt the local model can prefill fast, unlike the whole document.
      prompt: `Summarize page ${app.currentPage + 1} in a few short paragraphs.`,
      needsDoc: true,
    },
    {
      icon: ListChecks,
      label: "Key points",
      prompt: "Extract the key points of this document as a bullet list.",
      needsDoc: true,
    },
    {
      icon: Sparkles,
      label: "Explain page",
      prompt: `Explain what page ${app.currentPage + 1} is about in simple terms.`,
      needsDoc: true,
    },
  ];

  return (
    <>
    {selectionFab}
    <aside className="fixed inset-y-0 right-0 top-[42px] z-50 flex w-[360px] max-w-[88vw] shrink-0 flex-col border-l border-sidebar-border bg-sidebar shadow-xl lg:static lg:top-0 lg:z-auto lg:max-w-none lg:border-t lg:shadow-none">
      {/* header */}
      <div className="flex items-center gap-2 border-b border-sidebar-border px-4 py-2.5">
        <Bot className="h-4 w-4" />
        <span className="text-sm font-semibold">AI Assistant</span>
        <span
          title={statusDetail}
          className={cn(
            "ml-1 h-2 w-2 shrink-0 rounded-full",
            status === "ok" && "bg-emerald-500",
            status === "error" && "bg-red-500",
            status === "unknown" && "bg-amber-400",
          )}
        />
        <div className="ml-auto flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            title="Clear conversation"
            onClick={() => setMessages([])}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            title="Hide assistant"
            onClick={() => app.setAiOpen(false)}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* messages */}
      <div ref={scrollRef} className="scrollbar-soft min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {messages.length === 0 ? (
          <div className="flex flex-col gap-2 pt-2">
            <p className="px-1 text-xs text-muted-foreground">
              {app.pdf
                ? "Ask anything about the open document, or use a quick action."
                : "Open a PDF to chat about its content, or ask a general question."}
            </p>
            {quickActions.map((qa) => (
              <button
                key={qa.label}
                disabled={qa.needsDoc && !app.pdf}
                onClick={() => void send(qa.prompt)}
                className="flex items-center gap-2 rounded-lg border border-sidebar-border bg-background px-3 py-2 text-left text-xs font-medium shadow-sm transition-colors hover:bg-accent disabled:opacity-50"
              >
                <qa.icon className="h-3.5 w-3.5 text-muted-foreground" />
                {qa.label}
              </button>
            ))}
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {messages.map((m) => (
              <div
                key={m.id}
                className={cn(
                  "max-w-[92%] whitespace-pre-wrap rounded-xl px-3 py-2 text-[13px] leading-relaxed",
                  m.role === "user"
                    ? "self-end bg-primary text-primary-foreground"
                    : "self-start border border-sidebar-border bg-background shadow-sm",
                )}
              >
                {m.content || <TypingDots />}
                {m.role === "assistant" && m.content && !busy && (
                  <button
                    onClick={() => insertAsTextBox(m.content)}
                    className="mt-2 flex items-center gap-1 rounded-md border border-input bg-background px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  >
                    <CirclePlus className="h-3 w-3" />
                    Insert into page as text box
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* selection actions */}
      {selection && (
        <div className="border-t border-sidebar-border px-3 py-2">
          <p className="truncate pb-1.5 text-[11px] text-muted-foreground">
            Selected: “{selection.slice(0, 60)}{selection.length > 60 ? "…" : ""}”
          </p>
          <div className="flex flex-wrap gap-1.5">
            {SELECTION_ACTIONS.map(([label, instruction]) => (
              <button
                key={label}
                disabled={busy}
                onClick={() =>
                  void send(`${instruction}:\n\n"""${selection}"""`, {
                    selection: { page: selectionPage, text: selection },
                  })
                }
                className="rounded-md border border-sidebar-border bg-background px-2 py-1 text-[11px] font-medium transition-colors hover:bg-accent disabled:opacity-50"
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* composer */}
      <div className="border-t border-sidebar-border p-3">
        <div className="rounded-2xl bg-card shadow-shell ring-1 ring-border/80">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send(input);
              }
            }}
            rows={2}
            placeholder="Ask about the document, or ask for text to insert…"
            className="w-full resize-none border-0 bg-transparent px-4 py-3 text-sm outline-none placeholder:text-muted-foreground"
          />
          <div className="flex items-center justify-between gap-2 px-2 pb-2">
            <Select
              value={
                app.settings.provider === "browser"
                  ? BROWSER_MODEL_LABEL
                  : app.settings.model
              }
              onChange={(e) => {
                const v = e.target.value;
                if (v === SWITCH_PROVIDER) {
                  app.setScreen("settings");
                  return;
                }
                // Browser provider has no selectable model — ignore.
                if (app.settings.provider !== "browser") {
                  app.setSettings({ ...app.settings, model: v });
                }
              }}
              aria-label="Model"
              className="h-6 w-40 max-w-[60%] border-0 bg-transparent px-1 text-[10px] text-muted-foreground shadow-none"
            >
              {(app.settings.provider === "browser"
                ? [BROWSER_MODEL_LABEL]
                : [...new Set([app.settings.model, ...models].filter(Boolean))]
              ).map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
              <option value={SWITCH_PROVIDER}>Switch provider…</option>
            </Select>
            {busy ? (
              <Button variant="outline" size="icon" className="h-7 w-7" onClick={stop} title="Stop">
                <Square className="h-3.5 w-3.5" />
              </Button>
            ) : (
              <Button
                size="icon"
                className="h-7 w-7"
                disabled={!input.trim()}
                onClick={() => void send(input)}
                title="Send (Enter)"
              >
                <Send className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </div>
      </div>
    </aside>
    </>
  );
}
