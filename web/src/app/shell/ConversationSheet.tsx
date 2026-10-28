/**
 * The conversation (left sheet, ⌘J): what you told Naqsha and what it said, "Here's what I understood", and the
 * work in progress, where incoming changes tick off as they rebuild (DESIGN.md §5.5, "Revisions").
 */
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Check, CircleAlert } from "lucide-react";
import type { ChatMessage, Project } from "@contracts/api-types";
import { cn } from "@/app/lib/utils";
import { usePhone } from "@/app/lib/hooks";
import { useProject, type FeedItem, type Run } from "@/app/store/project";
import { NaqshaAvatar } from "@/app/ui/Avatar";
import { Chip, FactToken, SuggestionChip } from "@/app/ui/Chip";
import { Composer } from "@/app/ui/Composer";
import { Sheet } from "@/app/ui/Sheet";
import { useAsk } from "./ask";
import { plain } from "./narration";
import { useShell } from "./state";
import { untitle } from "@/app/plan/model";

export function ConversationSheet({ project, view }: { project: Project; view: string }) {
  const open = useShell((s) => s.left === "chat");
  const toggleChat = useShell((s) => s.toggleChat);
  const messages = useProject((s) => s.messages);
  const draft = useProject((s) => s.draft);
  const busy = useProject((s) => s.intakeBusy);
  const design = useProject((s) => s.design);
  const revise = useProject((s) => s.revise);
  const sendIntake = useProject((s) => s.sendIntake);
  const ask = useAsk();
  const phone = usePhone();
  const navigate = useNavigate();
  const [text, setText] = useState("");
  const end = useRef<HTMLDivElement>(null);

  const lastAssistant = useMemo(() => [...messages].reverse().find((m) => m.role === "assistant"), [messages]);
  const question = project.stage === "setup" && !busy && messages[messages.length - 1]?.role === "assistant" ? lastAssistant : undefined;

  useLayoutEffect(() => {
    if (open) end.current?.scrollIntoView({ block: "end" });
  }, [open, messages.length, draft, design.items.length, revise.items.length]);

  return (
    <Sheet
      open={open}
      onClose={() => toggleChat(false)}
      side="left"
      title="Conversation"
      footer={
        phone ? (
          <Composer
            value={text}
            onChange={setText}
            onSubmit={(t) => {
              setText("");
              ask.submit(t);
            }}
            placeholder="Ask Naqsha"
          />
        ) : undefined
      }
    >
      <div className="flex flex-col gap-5 pb-2 pt-1">
        {messages.length === 0 && !busy && (
          <p className="text-[15px] leading-[22px] text-ink-3">Tell me about the plot and who will live there. One message is enough.</p>
        )}
        {/* Suggestion chips only under Naqsha's latest turn, and never once the home has a version: setup chips
            ("Show me concepts", "Add a study") would be stale beside a revise. */}
        {messages.map((m) => (
          <Message key={m.id} m={m} chips={m.id === lastAssistant?.id && !project.current_version_id && !busy && design.status !== "running" && revise.status !== "running"} />
        ))}
        {draft !== null && draft !== "" && (
          <div className="flex gap-2.5">
            <NaqshaAvatar size={24} className="mt-0.5" />
            <p className="text-body-lg text-ink">
              {plain(draft)}
              <span className="ml-0.5 inline-block h-4 w-[2px] translate-y-0.5 bg-accent animate-caret" aria-hidden />
            </p>
          </div>
        )}
        {busy && !draft && (
          <div className="flex items-center gap-2.5 text-[14px] text-ink-3">
            <NaqshaAvatar size={24} />
            <span className="size-1.5 rounded-full bg-accent animate-breathe" aria-hidden />
            Thinking…
          </div>
        )}

        {question?.chips?.length && !question.multi && !question.input ? (
          <div className="flex flex-wrap gap-2 pl-[34px]">
            {question.chips.map((c) => (
              <Chip key={c.value} hint={c.hint} onClick={() => void sendIntake({ message: c.label, chips: [c.value] }, c.label)}>
                {c.label}
              </Chip>
            ))}
          </div>
        ) : question && (question.input || question.multi) && view !== "brief" ? (
          <div className="pl-[34px]">
            <SuggestionChip onClick={() => { toggleChat(false); navigate(`/app/p/${project.id}/brief`); }}>Answer in the Brief</SuggestionChip>
          </div>
        ) : null}

        <RunFeed run={revise} title="Your changes" />
        <RunFeed run={design} title="Designing your home" />
        <div ref={end} />
      </div>
    </Sheet>
  );
}

function Message({ m, chips }: { m: ChatMessage; chips?: boolean }) {
  const ask = useAsk();
  if (m.role === "user") {
    return (
      <div className="flex justify-end">
        <p className="max-w-[85%] whitespace-pre-wrap rounded-[20px] rounded-br-[6px] bg-surface-2 px-4 py-2.5 text-[15px] leading-[22px] text-ink">{m.text}</p>
      </div>
    );
  }
  const u = m.understood;
  return (
    <div className="flex gap-2.5">
      <NaqshaAvatar size={24} className="mt-0.5" />
      <div className="min-w-0 flex-1">
        <p className="whitespace-pre-wrap text-body-lg text-ink">{plain(m.text)}</p>
        {u && (u.guaranteed.length > 0 || u.preferences.length > 0 || u.assumptions.length > 0) && (
          <div className="mt-3 rounded-[16px] bg-canvas p-3.5 shadow-[inset_0_0_0_1px_var(--color-line)]">
            <p className="text-[13px] font-semibold text-ink">Here's what I understood</p>
            {u.guaranteed.length > 0 && (
              <Facts label="Guaranteed" items={u.guaranteed} />
            )}
            {u.preferences.length > 0 && <Facts label="Preferences" items={u.preferences} />}
            {u.assumptions.length > 0 && <Facts label="I assumed" items={u.assumptions} assumed />}
          </div>
        )}
        {chips && m.suggestions && m.suggestions.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {m.suggestions.slice(0, 3).map((s) => (
              <SuggestionChip key={s} onClick={() => ask.submit(s)}>{s}</SuggestionChip>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Facts({ label, items, assumed }: { label: string; items: string[]; assumed?: boolean }) {
  return (
    <div className="mt-2.5">
      <p className="mb-1.5 text-[12px] font-medium text-ink-3">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {items.map((t) => (
          <FactToken key={t} assumed={assumed}>{untitle(t)}</FactToken>
        ))}
      </div>
    </div>
  );
}

/** Stage lines of a design or revise run, ticking off as they finish; then the changes it made. */
function RunFeed({ run, title }: { run: Run; title: string }) {
  if (run.status === "idle" || !run.items.length) return null;
  const stages = run.items.filter((i): i is Extract<FeedItem, { kind: "stage" }> => i.kind === "stage");
  const error = run.items.find((i): i is Extract<FeedItem, { kind: "error" }> => i.kind === "error");
  const running = run.status === "running";
  const lines = stages.slice(-6);
  return (
    <div className="rounded-[16px] bg-canvas p-3.5 shadow-[inset_0_0_0_1px_var(--color-line)]">
      <p className="text-[13px] font-semibold text-ink">{title}</p>
      <ul className="mt-2 flex flex-col gap-1.5">
        {lines.map((s, i) => {
          const last = i === lines.length - 1;
          const active = running && last;
          return (
            <li key={s.id} className={cn("flex items-start gap-2 text-[14px] leading-5", active ? "text-ink" : "text-ink-3")}>
              {active ? (
                <span className="mt-[7px] size-1.5 shrink-0 rounded-full bg-accent animate-breathe" aria-hidden />
              ) : (
                <Check className="mt-0.5 size-4 shrink-0 text-pass" strokeWidth={2} aria-hidden />
              )}
              <span>{plain(s.message)}</span>
            </li>
          );
        })}
      </ul>
      {run.changes && run.changes.length > 0 && (
        <>
          <p className="mt-3 text-[12px] font-medium text-ink-3">Changes</p>
          <ul className="mt-1.5 flex flex-col gap-1.5">
            {run.changes.map((c) => (
              <li key={c.id} className="flex items-start gap-2 text-[14px] leading-5 text-ink">
                {running && !run.version ? (
                  <span className="mt-[7px] size-1.5 shrink-0 rounded-full bg-ink-4" aria-hidden />
                ) : (
                  <Check className="mt-0.5 size-4 shrink-0 text-pass" strokeWidth={2} aria-hidden />
                )}
                <span>{c.summary}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      {run.version && !running && <p className="mt-3 text-[13px] font-medium text-ink">Version {run.version.n} is ready.</p>}
      {error && (
        <p className="mt-3 flex items-start gap-2 text-[13px] leading-[18px] text-fail">
          <CircleAlert className="mt-px size-4 shrink-0" strokeWidth={1.75} />
          {error.message}
        </p>
      )}
    </div>
  );
}
