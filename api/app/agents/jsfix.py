"""Deterministic fixes for design.js sections before they reach the browser.

Every section runs on its own (the engine wraps each in its own function), but a model sometimes declares a shared palette
in one section (`const stoneClad = {...}`) and uses it in later ones, which then fail with "stoneClad is not defined".
`share_declarations` copies each missing top-level declaration (and the ones it depends on) into the sections that use it.
"""
from __future__ import annotations

import re

DECL_RE = re.compile(r"(?m)^\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=")
FUNC_RE = re.compile(r"(?m)^\s*function\s+([A-Za-z_$][\w$]*)\s*\(")
BUILTINS = {"s", "THREE", "Math", "JSON", "Object", "Array", "Number", "String", "console", "undefined", "null", "true", "false"}


def _statement_end(code: str, start: int) -> int:
    """Index just past the statement that starts at `start`: the first `;` (or newline after a closed expression) at depth 0,
    outside strings and comments."""
    depth, i, n = 0, start, len(code)
    quote = None
    while i < n:
        ch = code[i]
        if quote:
            if ch == "\\":
                i += 2
                continue
            if ch == quote:
                quote = None
        elif code.startswith("//", i):
            j = code.find("\n", i)
            i = n if j < 0 else j
            continue
        elif code.startswith("/*", i):
            j = code.find("*/", i + 2)
            i = n if j < 0 else j + 2
            continue
        elif ch in "'\"`":
            quote = ch
        elif ch in "([{":
            depth += 1
        elif ch in ")]}":
            depth -= 1
            if depth == 0 and code[i + 1:i + 2] == "\n" and code.startswith("function", start + len(code[start:]) - len(code[start:].lstrip())):
                return i + 1
        elif ch == ";" and depth == 0:
            return i + 1
        elif ch == "\n" and depth == 0 and i > start and not code[start:i].rstrip().endswith(("=", ",", "+", "-", "*", "/", "?", ":", "(", "{", "[", "&&", "||")):
            nxt = code[i + 1:].lstrip()[:1]
            if nxt not in (".", "?", ":", "+", "-", "*", "/", ")", "]", "}", ","):
                return i
        i += 1
    return n


def declarations(code: str) -> dict[str, str]:
    """Top-level `const/let/var NAME = …;` and `function NAME(…) {…}` statements of a section, by name."""
    out: dict[str, str] = {}
    for rx in (DECL_RE, FUNC_RE):
        for m in rx.finditer(code):
            line_start = code.rfind("\n", 0, m.start()) + 1
            if code[line_start:m.start()].strip() or (m.start() - line_start) > 0 and code[line_start] in " \t" and rx is DECL_RE and _indent(code, line_start) > 0:
                continue  # indented: inside a block, not top level
            end = _statement_end(code, m.start())
            out.setdefault(m.group(1), code[m.start():end].strip())
    return out


def _indent(code: str, line_start: int) -> int:
    return len(code[line_start:]) - len(code[line_start:].lstrip(" \t"))


def _uses(code: str, name: str) -> bool:
    return re.search(rf"(?<![\w$.]){re.escape(name)}(?![\w$])", code) is not None


def share_declarations(sections: list[dict]) -> list[str]:
    """Prepend missing declarations to the sections that use them. Returns 'section: names' lines for the log."""
    pool: dict[str, str] = {}
    for sec in sections:
        for name, stmt in declarations(sec["code"]).items():
            pool.setdefault(name, stmt)
    fixed = []
    for sec in sections:
        own = set(declarations(sec["code"]))
        need: list[str] = []

        def want(name: str, seen: set[str]) -> None:
            if name in own or name in seen or name in BUILTINS or name not in pool:
                return
            seen.add(name)
            for dep in pool:  # its own dependencies first
                if dep != name and _uses(pool[name], dep):
                    want(dep, seen)
            need.append(name)
        seen: set[str] = set()
        body = sec["code"]
        for name in pool:
            if name not in own and _uses(body, name):
                want(name, seen)
        if need:
            sec["code"] = "// shared declarations copied in (each section runs on its own)\n" + "\n".join(pool[n] for n in need) + "\n" + body
            fixed.append(f"{sec['name']}: {', '.join(need)}")
    return fixed
