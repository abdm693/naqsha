/**
 * Pin numbers that stay put across versions: every comment on the project, numbered by when it was made (approvals
 * aside). A pin numbered 3 on version 2 is still 3 on version 4, even after the threads before it were answered and
 * stayed on version 2. The whole project's list is fetched once per project (and again when a comment it doesn't
 * know turns up); until it arrives, the version's own comments are numbered the same way.
 */
import { useEffect, useMemo } from "react";
import { create } from "zustand";
import type { Comment } from "@contracts/api-types";
import { api } from "@/api/client";

interface AllComments {
  pid: string | null;
  list: { id: string; created_at: string; kind?: string }[] | null;
  loading: string | null;
}

const useAll = create<AllComments>(() => ({ pid: null, list: null, loading: null }));

async function load(pid: string) {
  if (useAll.getState().loading === pid) return;
  useAll.setState({ loading: pid });
  try {
    const list = await api.listComments(pid);
    useAll.setState({ pid, list: list.map((c) => ({ id: c.id, created_at: c.created_at, kind: c.kind })), loading: null });
  } catch {
    useAll.setState({ loading: null });
  }
}

/** The unknown ids a reload was last asked for, so a comment the list never returns can't cause a reload loop. */
let lastAsked = "";

export function usePinNumbers(pid: string | undefined, visible: Comment[] | undefined): Map<string, number> {
  const all = useAll((s) => (s.pid === pid ? s.list : null));
  const unknown = (visible ?? [])
    .filter((c) => c.kind !== "approval" && !all?.some((a) => a.id === c.id))
    .map((c) => c.id)
    .sort()
    .join(",");
  useEffect(() => {
    if (!pid) return;
    const ask = `${pid}:${all === null ? "*" : unknown}`;
    if ((all === null || unknown) && ask !== lastAsked) {
      lastAsked = ask;
      void load(pid);
    }
  }, [pid, all, unknown]);
  return useMemo(() => {
    const at = new Map<string, string>();
    for (const c of all ?? []) if (c.kind !== "approval") at.set(c.id, c.created_at);
    for (const c of visible ?? []) if (c.kind !== "approval") at.set(c.id, c.created_at);
    const sorted = [...at.entries()].sort((a, b) => a[1].localeCompare(b[1]) || a[0].localeCompare(b[0]));
    return new Map(sorted.map(([id], i) => [id, i + 1]));
  }, [all, visible]);
}
