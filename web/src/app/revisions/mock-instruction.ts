/**
 * Mock mode only: a revision from a typed instruction ("make the kitchen bigger"), as POST /revise {instruction}
 * does live. The mock reviser reads pinned comments, so the instruction is pinned (invisibly) in the room it names,
 * revised like a comment, and removed again; Naqsha's answer is streamed as the last step.
 */
import type { Comment } from "@contracts/api-types";
import type { BuildingPlan, Room } from "@contracts/plan";
import type { SSEHandlers, StreamOptions } from "@/api/client";
import { db, now, save, uid } from "@/api/mock/db";
import { reviseScript } from "@/api/mock/revise";
import { play } from "@/api/mock/stream";

const FT = 0.3048;

/** The room an instruction is about: by name ("bedroom 2"), then by type word ("kitchen"). */
function roomFor(plan: BuildingPlan, text: string): Room | undefined {
  const t = text.toLowerCase();
  const byName = [...plan.rooms].sort((a, b) => b.name.length - a.name.length).find((r) => t.includes(r.name.toLowerCase()));
  if (byName) return byName;
  const words: [RegExp, Room["type"][]][] = [
    [/\bmaster\b/, ["master_bedroom"]],
    [/\bguest\b/, ["guest_bedroom"]],
    [/\bbed ?rooms?\b/, ["bedroom", "master_bedroom"]],
    [/\bdirty kitchen\b/, ["dirty_kitchen"]],
    [/\bkitchen\b/, ["kitchen"]],
    [/\b(tv )?lounge\b/, ["lounge"]],
    [/\bdrawing\b/, ["drawing"]],
    [/\bdining\b/, ["dining"]],
    [/\bbath(room)?s?\b|\bwashroom\b/, ["bath", "powder"]],
    [/\bporch\b|\bparking\b/, ["porch"]],
    [/\bbalcon(y|ies)\b/, ["balcony"]],
    [/\bstairs?\b/, ["stair"]],
    [/\bstud(y|ies)\b/, ["study"]],
    [/\bprayer\b/, ["prayer"]],
    [/\blaundry\b/, ["laundry"]],
    [/\bstore\b/, ["store"]],
  ];
  for (const [re, types] of words) if (re.test(t)) return plan.rooms.find((r) => types.includes(r.type));
  return undefined;
}

export async function mockInstructionRevise(pid: string, versionId: string, instruction: string, handlers: SSEHandlers, opts?: StreamOptions): Promise<void> {
  const d = db();
  const base = d.versions[versionId];
  const plan = base?.plan;
  const room = plan ? roomFor(plan, instruction) : undefined;
  const lvl = room ? plan!.levels.find((l) => l.id === room.level) : plan?.levels[0];
  const cx = room ? room.rect.x + room.rect.w / 2 : (plan?.site.plot.width_ft ?? 30) / 2;
  const cy = room ? room.rect.y + room.rect.d / 2 : (plan?.site.plot.depth_ft ?? 60) / 2;
  const h = (lvl?.elevation_ft ?? 0) + 4;
  const pseudo: Comment = {
    id: uid("ask"),
    version_id: versionId,
    text: instruction,
    anchor: { position: [cx * FT, h * FT, -cy * FT], normal: [0, 1, 0], level: room?.level, room: room?.id, kind: "instruction", label: room?.name },
    camera: { position: [cx * FT, h * FT + 8, -cy * FT + 10], target: [cx * FT, h * FT, -cy * FT] },
    created_at: now(),
    status: "open",
  };
  (d.comments[pid] ??= []).push(pseudo);
  save();

  let answer: string | undefined;
  const wrapped: SSEHandlers = {
    ...handlers,
    stage: (data) => {
      const message = /reviewing your 1 comment/i.test(data.message) ? `Reading your request: “${instruction}”` : data.message;
      handlers.stage?.({ ...data, message });
    },
    comment: ({ comment }) => {
      if (comment.id === pseudo.id) {
        answer = comment.resolution;
        return;
      }
      handlers.comment?.({ comment });
    },
    version: (data) => {
      if (answer) handlers.stage?.({ stage: "save", message: answer });
      handlers.version?.(data);
    },
  };
  try {
    await play(reviseScript(pid, versionId, [pseudo.id]), wrapped, opts?.signal);
  } finally {
    const list = db().comments[pid] ?? [];
    db().comments[pid] = list.filter((c) => c.id !== pseudo.id);
    save();
  }
}
