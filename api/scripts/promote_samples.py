"""Promote finished projects to sample homes (owner "samples") and retire old samples.

    uv run python scripts/promote_samples.py clone p_new1 p_new2          # copy each into the samples workspace (prints new ids)
    uv run python scripts/promote_samples.py verify p_s1 p_s2             # versions, comments, messages and fresh compliance
    uv run python scripts/promote_samples.py archive p_old1 p_old2        # reversible: owner "samples" -> "samples-archive"
    uv run python scripts/promote_samples.py restore p_old1 p_old2        # undo archive
    uv run python scripts/promote_samples.py delete p_old1 p_old2         # permanent (db.delete_project)

Every command refuses projects that are not in the expected workspace.
"""
from __future__ import annotations

import asyncio
import json
import sys

from app.compliance import lda
from app.store import db

ARCHIVE_OWNER = "samples-archive"


def fails(report: dict) -> dict:
    out = {"lda": 0, "livable": 0}
    for c in report.get("checks", []):
        if c["status"] == "fail":
            out[c.get("category", "lda")] = out.get(c.get("category", "lda"), 0) + 1
    return out


async def verify(pid: str) -> dict:
    p = await db.get_project(pid)
    if not p:
        return {"id": pid, "missing": True}
    vs = []
    for v in p.get("versions") or []:
        full = await db.get_version(pid, v["id"])
        rep = lda.check(full["plan"], p.get("brief"))
        vs.append({"id": v["id"], "n": v["n"], "stored": lda.counts(full["compliance"]), "stored_fails": fails(full["compliance"]),
                   "recheck_fails": fails(rep), "recheck": lda.counts(rep)})
    cs = await db.list_comments(pid)
    return {"id": pid, "name": p["name"], "owner": p["owner"], "cloned_from": p.get("cloned_from"), "stage": p.get("stage"),
            "current_version_id": p.get("current_version_id"), "thumbnail_url": p.get("thumbnail_url"),
            "selected_concept_id": p.get("selected_concept_id"), "concepts": len(p.get("concepts") or []),
            "night": sum(1 for c in p.get("concepts") or [] if c.get("night_url")), "versions": vs,
            "comments": [{"id": c["id"], "status": c.get("status"), "replies": len(c.get("replies") or [])} for c in cs],
            "messages": len(await db.list_messages(pid))}


async def main(cmd: str, pids: list[str]):
    out = []
    for pid in pids:
        p = await db.get_project(pid)
        if cmd == "verify":
            out.append(await verify(pid))
        elif cmd == "clone":
            if not p or p["owner"] == db.SAMPLES_OWNER:
                raise SystemExit(f"{pid}: not found or already a sample")
            s = await db.clone_project(pid, db.SAMPLES_OWNER, p["name"])
            out.append({"from": pid, "sample": s["id"], "name": s["name"]})
        elif cmd == "archive":
            if not p or p["owner"] != db.SAMPLES_OWNER:
                raise SystemExit(f"{pid}: not a sample")
            await db.update_project(pid, owner=ARCHIVE_OWNER, archived_from_owner=db.SAMPLES_OWNER)
            out.append({"archived": pid})
        elif cmd == "restore":
            if not p or p["owner"] != ARCHIVE_OWNER:
                raise SystemExit(f"{pid}: not archived")
            await db.update_project(pid, owner=db.SAMPLES_OWNER)
            out.append({"restored": pid})
        elif cmd == "delete":
            if not p or p["owner"] not in (db.SAMPLES_OWNER, ARCHIVE_OWNER):
                raise SystemExit(f"{pid}: not a sample")
            await db.delete_project(pid)
            out.append({"deleted": pid})
    print(json.dumps(out, indent=1, ensure_ascii=False))


if __name__ == "__main__":
    asyncio.run(main(sys.argv[1], sys.argv[2:]))
