"""Run the tool-using plan fixer on a saved plan. Usage: python scripts/try_fix.py brief.json plan.json out.json"""
import asyncio, json, sys, time, logging
from dotenv import load_dotenv
load_dotenv("../.env")
sys.path.insert(0, ".")
from app.agents import architect, fixer
from app.compliance import lda
logging.basicConfig(level=logging.INFO); logging.getLogger("naqsha.fixer").setLevel(logging.DEBUG); logging.getLogger("httpx").setLevel(logging.WARNING)


async def main():
    brief, plan = json.load(open(sys.argv[1])), json.load(open(sys.argv[2]))
    plan, _ = architect.prepare(plan, brief)
    print("start:", lda.status_line(lda.check(plan, brief)), flush=True)
    t0 = time.time()
    async for ev, d in fixer.fix(plan, brief, architect.prepare):
        if ev == "edit":
            print(f"[{time.time()-t0:4.0f}s] kept edit: fixed {d['fixed']} -> {d['failures']} failures left {d['summary']}", flush=True)
        elif ev == "_result":
            json.dump(d["plan"], open(sys.argv[3], "w"), indent=1)
            print("end:", lda.status_line(d["report"]), d["steps"], "steps", d["kept"], "kept", flush=True)
            for c in d["report"]["checks"]:
                if c["status"] == "fail": print("  FAIL", c["id"], c["message"][:120])
asyncio.run(main())
