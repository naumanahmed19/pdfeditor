import { useCallback, useEffect, useRef, useState } from "react";
import {
  Bot,
  CirclePlus,
  ListChecks,
  Loader2,
  ScrollText,
  Send,
  Sparkles,
  Square,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { useApp } from "../../store";
import { Button } from "../ui/button";
import { Select } from "../ui/select";
import { cn, uid } from "../../lib/utils";
import { extractAllText } from "../../lib/pdf";
import { checkConnection, streamChat } from "../../lib/ai";
import type { ChatMessage } from "../../types";

interface UiMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
}

const CHAT_KEY = "pdf-workbench-chat";

function loadChat(): UiMessage[] {
  try {
    return JSON.parse(localStorage.getItem(CHAT_KEY) ?? "[]");
  } catch {
    return [];
  }
}

export function AiPanel() {
  const app = useApp();
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
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Track text selection inside the PDF text layer.
  useEffect(() => {
    const onSel = () => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed) return setSelection("");
      const anchor = sel.anchorNode?.parentElement;
      if (anchor?.closest(".textLayer")) {
        setSelection(sel.toString().trim().slice(0, 4000));
      }
    };
    document.addEventListener("selectionchange", onSel);
    return () => document.removeEventListener("selectionchange", onSel);
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

  const buildContext = useCallback(async (): Promise<string> => {
    if (!app.pdf) return "";
    const pages = await extractAllText(app.pdf);
    const limit = app.settings.contextChars;
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
    return ctx;
  }, [app.pdf, app.currentPage, app.settings.contextChars]);

  const send = useCallback(
    async (userText: string) => {
      if (!userText.trim() || busy) return;
      setBusy(true);
      setInput("");
      const userMsg: UiMessage = { id: uid(), role: "user", content: userText };
      const assistantMsg: UiMessage = { id: uid(), role: "assistant", content: "" };
      setMessages((prev) => [...prev, userMsg, assistantMsg]);

      try {
        const context = await buildContext();
        const system = [
          "You are a helpful PDF assistant inside a PDF editor called PDF Workbench.",
          "Be concise and practical. Answer questions about the document, summarize, rewrite, translate or draft text when asked.",
          "When the user asks you to write or rewrite text that will be inserted into the PDF, output ONLY the text to insert, no preamble.",
          app.docName ? `The open document is "${app.docName}" (${app.numPages} pages). The user is viewing page ${app.currentPage + 1}.` : "No document is open.",
          context ? `Document content (may be truncated):\n${context}` : "",
        ]
          .filter(Boolean)
          .join("\n\n");

        const history: ChatMessage[] = [
          { role: "system", content: system },
          ...messages.map((m) => ({ role: m.role, content: m.content }) as ChatMessage),
          { role: "user", content: userText },
        ];

        abortRef.current = new AbortController();
        await streamChat(
          app.settings,
          history,
          (delta) => {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMsg.id ? { ...m, content: m.content + delta } : m,
              ),
            );
          },
          abortRef.current.signal,
        );
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          const msg = err instanceof Error ? err.message : "Request failed";
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantMsg.id
                ? {
                    ...m,
                    content:
                      m.content ||
                      `⚠️ ${msg}\n\nCheck that ${app.settings.provider === "ollama" ? "Ollama" : app.settings.provider === "lmstudio" ? "LM Studio" : "your API"} is running and the model "${app.settings.model}" is available (Settings).`,
                  }
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

  if (!app.aiOpen) return null;

  const quickActions = [
    {
      icon: ScrollText,
      label: "Summarize",
      prompt: "Summarize this document in a few short paragraphs.",
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
    <aside className="fixed inset-y-0 right-0 top-[42px] z-40 flex w-[360px] max-w-[88vw] shrink-0 flex-col border-l border-sidebar-border bg-sidebar shadow-xl lg:static lg:top-0 lg:z-auto lg:max-w-none lg:border-t lg:shadow-none">
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
        {models.length > 0 ? (
          <Select
            value={app.settings.model}
            onChange={(e) =>
              app.setSettings({ ...app.settings, model: e.target.value })
            }
            aria-label="Model"
            className="h-6 w-28 border-0 bg-transparent px-1 text-[11px] text-muted-foreground shadow-none"
          >
            {[...new Set([...models, app.settings.model])].map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </Select>
        ) : (
          <span className="max-w-[120px] truncate text-[11px] text-muted-foreground">
            {app.settings.model}
          </span>
        )}
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
            className="h-6 w-6 lg:hidden"
            title="Close"
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
                {m.content || (
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                )}
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
            {[
              ["Rewrite", "Rewrite this text more clearly and professionally"],
              ["Fix grammar", "Fix the grammar and spelling of this text; keep meaning identical"],
              ["Translate to English", "Translate this text to English"],
              ["Explain", "Explain this text simply"],
            ].map(([label, instruction]) => (
              <button
                key={label}
                disabled={busy}
                onClick={() => void send(`${instruction}:\n\n"""${selection}"""`)}
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
            <span className="px-1.5 text-[11px] text-muted-foreground">
              {app.settings.provider === "ollama"
                ? "Ollama (local)"
                : app.settings.provider === "lmstudio"
                  ? "LM Studio (local)"
                  : "Custom API"}
            </span>
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
  );
}
