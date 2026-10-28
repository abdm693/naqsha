"""Auth helpers and the collaboration API (roles, invites, the client link, replies, claim, sample de-dupe).

Firestore is replaced by a small in-memory store with the same functions, and token verification by a fake that maps
"tok-<uid>" to claims, so these tests exercise the real routes and permission logic offline.
"""
import copy
import itertools

import pytest
from fastapi.testclient import TestClient

from app import auth, config
from app.store import db

GUEST_A = "7c27b88c-26bb-43ef-b90a-cbadfcae4ffd"
GUEST_B = "11111111-2222-3333-4444-555555555555"


# --- pure helpers ----------------------------------------------------------------------------------------------------------
def test_valid_guest_rejects_reserved_and_owner_keys():
    assert auth.valid_guest(GUEST_A) == GUEST_A
    assert auth.valid_guest("samples") is None
    assert auth.valid_guest("user:abc") is None
    assert auth.valid_guest("anon") is None
    assert auth.valid_guest("") is None
    assert auth.valid_guest("../../etc") is None


def test_identity_from_claims_and_guest():
    me = auth.identity_from({"user_id": "u1", "email": "Ayesha@Example.com", "name": "Ayesha"}, GUEST_A)
    assert me.signed_in and me.key == "user:u1" and me.email == "ayesha@example.com"
    assert me.owner_keys == {"user:u1", GUEST_A}       # unclaimed guest projects stay theirs
    assert me.author_id == "u1"
    g = auth.identity_from(None, GUEST_A)
    assert not g.signed_in and g.key == GUEST_A and g.author_id == GUEST_A


def test_verify_token_checks_issuer_and_caches(monkeypatch):
    calls = itertools.count()
    good = {"iss": f"https://securetoken.google.com/{config.AUTH_PROJECT}", "user_id": "u1", "exp": 9e12}

    def fake_verify(token, request, audience):
        next(calls)
        assert audience == config.AUTH_PROJECT
        return dict(good) if token == "good" else {**good, "iss": "https://evil.example"}

    from google.oauth2 import id_token
    monkeypatch.setattr(id_token, "verify_firebase_token", fake_verify)
    auth._tokens.clear()
    assert auth.verify_token("good")["user_id"] == "u1"
    assert auth.verify_token("good")["user_id"] == "u1"
    assert next(calls) == 1                      # the second call was served from the cache
    with pytest.raises(ValueError):
        auth.verify_token("bad")


def test_cached_request_honours_max_age(monkeypatch):
    class Resp:
        status = 200
        headers = {"cache-control": "public, max-age=600"}
        data = b"{}"

    hits = []

    class Inner:
        def __call__(self, url, **kw):
            hits.append(url)
            return Resp()

    r = auth._CachedRequest.__new__(auth._CachedRequest)
    r._inner, r._cache = Inner(), {}
    import threading
    r._lock = threading.Lock()
    r("https://www.googleapis.com/certs")
    r("https://www.googleapis.com/certs")
    assert hits == ["https://www.googleapis.com/certs"]


# --- in-memory store -------------------------------------------------------------------------------------------------------------
class FakeDB:
    def __init__(self):
        self.projects, self.comments, self.versions, self.n = {}, {}, {}, itertools.count(1)

    def install(self, mp):
        for name in ("get_project", "list_projects", "list_member_projects", "create_project", "update_project", "set_members",
                     "resolve_invites", "find_by_share_token", "claim_projects", "list_comments", "add_comment", "get_comment",
                     "update_comment", "add_reply", "delete_comment", "get_version", "list_clones", "untouched_copy",
                     "clone_project", "delete_project", "list_messages", "refresh_clone"):
            mp.setattr(db, name, getattr(self, name))

    async def get_project(self, pid):
        return copy.deepcopy(self.projects.get(pid))

    async def list_projects(self, owner):
        return [copy.deepcopy(p) for p in self.projects.values() if p["owner"] == owner]

    async def list_member_projects(self, uid):
        return [copy.deepcopy(p) for p in self.projects.values() if uid in p.get("member_uids", [])]

    async def create_project(self, owner, name):
        pid = f"p_{next(self.n)}"
        self.projects[pid] = {"id": pid, "owner": owner, "name": name or "Untitled home", "updated_at": f"{next(self.n):05d}",
                              "stage": "setup", "brief": None, "concepts": [], "versions": [], "members": [], "member_uids": [],
                              "member_emails": [], "current_version_id": None}
        return copy.deepcopy(self.projects[pid])

    async def update_project(self, pid, **f):
        self.projects[pid].update(copy.deepcopy(f))
        return copy.deepcopy(self.projects[pid])

    async def set_members(self, pid, members):
        return await self.update_project(pid, **db._flat(members))

    async def resolve_invites(self, email, uid, name=None):
        n = 0
        for p in self.projects.values():
            for m in p.get("members", []):
                if email and m["email"] == email and m.get("status") != "active":
                    m.update(status="active", uid=uid)
                    p.update(db._flat(p["members"]))
                    n += 1
        return n

    async def find_by_share_token(self, token):
        return next((copy.deepcopy(p) for p in self.projects.values() if p.get("share_token") == token and p.get("share_enabled")), None)

    async def claim_projects(self, guest, key, uid):
        moved = [p for p in self.projects.values() if p["owner"] == guest]
        for p in moved:
            p["owner"] = key
        return len(moved)

    async def list_comments(self, pid, version_id=None):
        return [copy.deepcopy(c) for c in self.comments.get(pid, {}).values() if not version_id or c["version_id"] == version_id]

    async def add_comment(self, pid, c):
        self.comments.setdefault(pid, {})[c["id"]] = copy.deepcopy(c)
        return c

    async def get_comment(self, pid, cid):
        return copy.deepcopy(self.comments.get(pid, {}).get(cid))

    async def update_comment(self, pid, cid, **f):
        self.comments[pid][cid].update(f)
        return copy.deepcopy(self.comments[pid][cid])

    async def add_reply(self, pid, cid, r):
        c = self.comments.get(pid, {}).get(cid)
        if not c:
            return None
        c.setdefault("replies", []).append(r)
        return copy.deepcopy(c)

    async def delete_comment(self, pid, cid):
        self.comments.get(pid, {}).pop(cid, None)

    async def get_version(self, pid, vid):
        return copy.deepcopy(self.versions.get(vid))

    async def list_clones(self, owner, src):
        copies = [p for p in self.projects.values() if p["owner"] == owner and p.get("cloned_from") == src]
        return [copy.deepcopy(p) for p in sorted(copies, key=lambda p: p.get("created_at", ""), reverse=True)]

    async def untouched_copy(self, c, src):
        """The real rule's shape: the name it was made with, and no comments or versions beyond the sample's."""
        own = {k for k in self.comments.get(c["id"], {})} - {k for k in self.comments.get(src["id"], {})}
        return not (db.renamed(c, src) or own or c.get("touched")
                    or {v["id"] for v in c.get("versions") or []} - {v["id"] for v in src.get("versions") or []})

    async def clone_project(self, src, owner, name=None, once=False, slot=1):
        pid = db.clone_id(owner, src, slot) if once else f"p_{next(self.n)}"
        if once and pid in self.projects:
            return copy.deepcopy(self.projects[pid])
        doc = db._copy_doc(copy.deepcopy(self.projects[src]), pid, owner, name)
        self.projects[pid] = {**doc, "created_at": f"{next(self.n):05d}"}
        return copy.deepcopy(self.projects[pid])

    async def refresh_clone(self, pid, src, owner, name=None):
        doc = db._copy_doc(copy.deepcopy(src), pid, owner, name)
        self.projects[pid] = {**doc, "created_at": f"{next(self.n):05d}", "refreshed": True}
        return copy.deepcopy(self.projects[pid])

    async def delete_project(self, pid):
        self.projects.pop(pid, None)

    async def list_messages(self, pid):
        return []


@pytest.fixture
def api(monkeypatch):
    fake = FakeDB()
    fake.install(monkeypatch)

    def fake_verify(token):
        if not token.startswith("tok-"):
            raise ValueError("bad token")
        uid = token[4:]
        return {"user_id": uid, "email": f"{uid}@example.com", "name": uid.title()}
    monkeypatch.setattr(auth, "verify_token", fake_verify)
    from app import main
    return TestClient(main.app), fake


def main_handle(pid, raw):
    from app import main
    return main.author_handle(pid, raw)


def H(guest=None, token=None):
    h = {}
    if guest:
        h["X-Naqsha-User"] = guest
    if token:
        h["Authorization"] = f"Bearer {token}"
    return h


def test_config_serves_the_browser_key(api, monkeypatch):
    client, _ = api
    monkeypatch.setattr(config, "AUTH_API_KEY", "browser-key")
    j = client.get("/api/config").json()
    assert j == {"auth": {"api_key": "browser-key", "project_id": config.AUTH_PROJECT}}


def test_me_requires_a_token(api):
    client, _ = api
    assert client.get("/api/me", headers=H(GUEST_A)).status_code == 401
    assert client.get("/api/me", headers=H(token="tok-ayesha")).json()["user"]["uid"] == "ayesha"
    assert client.get("/api/me", headers=H(token="garbage")).status_code == 401


def test_roles_invites_and_permissions(api):
    client, fake = api
    pid = client.post("/api/projects", json={"name": "Home"}, headers=H(token="tok-owner")).json()["id"]
    # owner invites a team member and a client by email
    assert client.post(f"/api/projects/{pid}/members", json={"email": "arch@example.com", "role": "team"}, headers=H(token="tok-owner")).json()["status"] == "invited"
    client.post(f"/api/projects/{pid}/members", json={"email": "cli@example.com", "role": "client"}, headers=H(token="tok-owner"))
    # a stranger sees nothing
    assert client.get(f"/api/projects/{pid}", headers=H(GUEST_B)).status_code == 404
    # the invite resolves when that email signs in, and the project shows up in their workspace with their role
    lst = client.get("/api/projects", headers=H(token="tok-arch")).json()["projects"]
    assert [(p["id"], p["role"]) for p in lst] == [(pid, "team")]
    assert fake.projects[pid]["member_uids"] == ["arch"]
    # the client can view and comment but not design or invite
    assert client.get(f"/api/projects/{pid}", headers=H(token="tok-cli")).json()["role"] == "client"
    assert "brief" not in client.get(f"/api/projects/{pid}", headers=H(token="tok-cli")).json()
    assert client.post(f"/api/projects/{pid}/design", headers=H(token="tok-cli")).status_code == 403
    assert client.post(f"/api/projects/{pid}/members", json={"email": "x@example.com", "role": "team"}, headers=H(token="tok-cli")).status_code == 403
    c = client.post(f"/api/projects/{pid}/comments", json={"version_id": "v1", "text": "Bigger window?", "anchor": {}, "camera": {}},
                    headers=H(token="tok-cli")).json()
    assert c["author"] == {"id": main_handle(pid, "cli"), "name": "Cli", "role": "client"} and c["replies"] == [] and c["mine"]
    # the team member replies; the client can't resolve someone else's comment, the team can
    r = client.post(f"/api/projects/{pid}/comments/{c['id']}/replies", json={"text": "On it."}, headers=H(token="tok-arch")).json()
    assert r["replies"][-1]["author"]["role"] == "team"
    tc = client.post(f"/api/projects/{pid}/comments", json={"version_id": "v1", "text": "Team note", "anchor": {}, "camera": {}},
                     headers=H(token="tok-arch")).json()
    assert client.patch(f"/api/projects/{pid}/comments/{tc['id']}", json={"status": "resolved"}, headers=H(token="tok-cli")).status_code == 403
    assert client.patch(f"/api/projects/{pid}/comments/{c['id']}", json={"status": "resolved"}, headers=H(token="tok-arch")).json()["status"] == "resolved"
    # members listing and role change; only the owner deletes
    ms = client.get(f"/api/projects/{pid}/members", headers=H(token="tok-owner")).json()["members"]
    assert {m["email"]: m["status"] for m in ms} == {"arch@example.com": "active", "cli@example.com": "active"}
    assert client.patch(f"/api/projects/{pid}/members/cli@example.com", json={"role": "team"}, headers=H(token="tok-owner")).json()["role"] == "team"
    assert client.delete(f"/api/projects/{pid}", headers=H(token="tok-arch")).status_code == 403


def test_client_link(api):
    client, fake = api
    pid = client.post("/api/projects", json={}, headers=H(GUEST_A)).json()["id"]
    fake.projects[pid]["current_version_id"] = "v1"
    fake.versions["v1"] = {"id": "v1", "n": 1, "plan": {}, "sections": []}
    s = client.post(f"/api/projects/{pid}/share", json={"enabled": True}, headers=H(GUEST_A)).json()
    assert s["enabled"] and s["url"].endswith(f"/s/{s['token']}")
    view = client.get(f"/api/share/{s['token']}").json()
    assert view["role"] == "client" and view["version"]["id"] == "v1" and "brief" not in view["project"]
    c = client.post(f"/api/share/{s['token']}/comments", json={"author_name": "Mr. Khan", "text": "Love the porch", "anchor": {},
                                                               "camera": {}}, headers=H(GUEST_B)).json()
    assert c["author"]["name"] == "Mr. Khan" and c["author"]["role"] == "client" and c["version_id"] == "v1"
    assert c["author"]["id"] != GUEST_B and c["author"]["id"].startswith("a_") and c["mine"] is True
    r = client.post(f"/api/share/{s['token']}/comments/{c['id']}/replies", json={"text": "Thanks", "author_name": "Mr. Khan"}).json()
    assert r["replies"][0]["text"] == "Thanks"
    assert client.post(f"/api/projects/{pid}/share", json={"enabled": False}, headers=H(GUEST_A)).json()["enabled"] is False
    assert client.get(f"/api/share/{s['token']}").status_code == 404


def test_claim_moves_guest_projects(api):
    client, fake = api
    pid = client.post("/api/projects", json={}, headers=H(GUEST_A)).json()["id"]
    # signed in but not claimed yet: still their project
    assert client.get(f"/api/projects/{pid}", headers=H(GUEST_A, "tok-ayesha")).json()["role"] == "owner"
    assert client.post("/api/me/claim", json={"guest_id": GUEST_A}, headers=H(GUEST_A, "tok-ayesha")).json() == {"moved": 1}
    assert fake.projects[pid]["owner"] == "user:ayesha"
    # from another browser, signed in, it's there
    assert [p["id"] for p in client.get("/api/projects", headers=H(token="tok-ayesha")).json()["projects"]] == [pid]
    assert client.post("/api/me/claim", json={"guest_id": GUEST_A}, headers=H(GUEST_A)).status_code == 401


def test_header_cannot_impersonate_samples_or_users(api):
    client, fake = api
    fake.projects["p_s"] = {"id": "p_s", "owner": db.SAMPLES_OWNER, "name": "Sample", "members": [], "updated_at": "1"}
    fake.projects["p_u"] = {"id": "p_u", "owner": "user:ayesha", "name": "Hers", "members": [], "updated_at": "1"}
    for header in ("samples", "user:ayesha"):
        assert client.get("/api/projects/p_s", headers={"X-Naqsha-User": header}).status_code == 404
        assert client.get("/api/projects/p_u", headers={"X-Naqsha-User": header}).status_code == 404
        assert client.delete("/api/projects/p_s", headers={"X-Naqsha-User": header}).status_code == 404


def test_sample_clone_is_deduplicated(api):
    client, fake = api
    fake.projects["p_s"] = {"id": "p_s", "owner": db.SAMPLES_OWNER, "name": "Sample", "members": [], "updated_at": "1", "versions": []}
    a = client.post("/api/projects/p_s/clone", json={}, headers=H(GUEST_A)).json()
    b = client.post("/api/projects/p_s/clone", json={}, headers=H(GUEST_A)).json()
    c = client.post("/api/projects/p_s/clone", json={"fresh": True}, headers=H(GUEST_A)).json()
    assert a["id"] == b["id"] != c["id"]
    assert client.post("/api/projects/p_s/clone", json={}, headers=H(GUEST_B)).json()["id"] not in (a["id"], c["id"])


def test_old_versions_are_rechecked_on_read(plans):
    from app import main
    old = {"id": "v1", "plan": plans["1-kanal"], "compliance": {"ok": True, "checks": [{"id": "coverage", "status": "pass"}]}}
    v = main.fresh_version(old, None)
    cats = {c["category"] for c in v["compliance"]["checks"]}
    assert cats == {"lda", "livable"} and not v["compliance"]["ok"]   # the villa's bedrooms open into bedrooms
    new = {"id": "v2", "plan": plans["example"], "compliance": {"ok": True, "checks": [{"id": "x", "status": "pass", "category": "lda"}]}}
    assert main.fresh_version(new, None)["compliance"]["checks"] == [{"id": "x", "status": "pass", "category": "lda"}]


def _shared_project(client, fake):
    pid = client.post("/api/projects", json={}, headers=H(GUEST_A)).json()["id"]
    fake.projects[pid]["current_version_id"] = "v1"
    fake.versions["v1"] = {"id": "v1", "n": 1, "plan": {}, "sections": []}
    s = client.post(f"/api/projects/{pid}/share", json={"enabled": True}, headers=H(GUEST_A)).json()
    return pid, s["token"]


def test_share_payloads_never_carry_raw_ids(api):
    """BE-10: a guest id is a login credential; share payloads carry per-project handles and `mine` instead."""
    client, fake = api
    pid, token = _shared_project(client, fake)
    own = client.post(f"/api/projects/{pid}/comments", json={"version_id": "v1", "text": "Owner note", "anchor": {}, "camera": {}},
                      headers=H(GUEST_A)).json()
    assert own["author"]["id"] != GUEST_A and own["mine"] is True        # the owner's own app gets the handle too (BE-F7)
    cli = client.post(f"/api/share/{token}/comments", json={"author_name": "Mr. Khan", "text": "Porch?", "anchor": {}, "camera": {}},
                      headers=H(GUEST_B)).json()
    client.post(f"/api/projects/{pid}/comments/{cli['id']}/replies", json={"text": "Looking at it"}, headers=H(GUEST_A))
    for headers in ({}, H(GUEST_B), H(token="tok-stranger")):
        for body in (client.get(f"/api/share/{token}", headers=headers).text,
                     client.get(f"/api/share/{token}/comments", headers=headers).text):
            assert GUEST_A not in body and GUEST_B not in body
    view = client.get(f"/api/share/{token}", headers=H(GUEST_B)).json()
    by = {c["text"]: c for c in view["comments"]}
    assert by["Porch?"]["mine"] is True and by["Owner note"]["mine"] is False
    assert by["Porch?"]["replies"][0]["mine"] is False
    # handles are stable: the same author has the same handle in every payload
    assert by["Owner note"]["author"]["id"] == by["Porch?"]["replies"][0]["author"]["id"]
    # the owner's list shows the client as a handle, and the owner's own comment as theirs
    lst = client.get(f"/api/projects/{pid}/comments", headers=H(GUEST_A)).json()["comments"]
    assert GUEST_B not in str(lst) and {c["text"]: c["mine"] for c in lst} == {"Owner note": True, "Porch?": False}
    assert GUEST_A not in str(lst)
    # BE-F7: one author, one handle, whoever asks (the pin and avatar colour hash it): the owner's tab and the client link
    owner_view = {c["text"]: c["author"]["id"] for c in lst}
    client_view = {c["text"]: c["author"]["id"] for c in view["comments"]}
    assert owner_view == client_view
    # an anonymous visitor ("anon") never owns anyone's comment
    assert not any(c["mine"] for c in client.get(f"/api/share/{token}").json()["comments"])


def test_client_approval_is_not_a_change_request(api):
    """BE-25: Approve vN is stored resolved with kind "approval"; general pins don't stack."""
    client, fake = api
    pid, token = _shared_project(client, fake)
    anchor = {"position": [5.3, 4, -6.6], "normal": [0, 0, 1], "label": "Whole home", "kind": "view"}
    a = client.post(f"/api/share/{token}/comments", json={"author_name": "Mr. Khan", "text": "Approved version 1.", "anchor": anchor,
                                                           "camera": {}}, headers=H(GUEST_B)).json()
    assert a["kind"] == "approval" and a["status"] == "resolved"
    b = client.post(f"/api/share/{token}/comments", json={"author_name": "Mr. Khan", "text": "Looks good", "anchor": anchor,
                                                           "camera": {}, "kind": "approval"}, headers=H(GUEST_B)).json()
    assert b["kind"] == "approval"
    n = client.post(f"/api/share/{token}/comments", json={"author_name": "Mr. Khan", "text": "Bigger kitchen", "anchor": anchor,
                                                           "camera": {}}, headers=H(GUEST_B)).json()
    assert n["status"] == "open" and "kind" not in n
    assert len({tuple(x["anchor"]["position"]) for x in (a, b, n)}) == 3   # three general pins, three places
    # Revise with every open comment takes only the change request; a picked approval is ignored
    assert client.post(f"/api/projects/{pid}/revise", json={"version_id": "v1", "comment_ids": [a["id"]]},
                       headers=H(GUEST_A)).status_code == 400


def test_stale_untouched_sample_copy_is_refreshed(api):
    client, fake = api
    fake.projects["p_s"] = {"id": "p_s", "owner": db.SAMPLES_OWNER, "name": "Sample", "members": [], "updated_at": "00001", "versions": []}
    a = client.post("/api/projects/p_s/clone", json={}, headers=H(GUEST_A)).json()
    fake.projects["p_s"]["updated_at"] = "99999"        # the sample was promoted again
    b = client.post("/api/projects/p_s/clone", json={}, headers=H(GUEST_A)).json()
    assert b["id"] == a["id"] and fake.projects[a["id"]].get("refreshed")
    lst = [p for p in client.get("/api/projects", headers=H(GUEST_A)).json()["projects"] if p.get("cloned_from") == "p_s"]
    assert len(lst) == 1


def test_brief_edit_after_design_keeps_the_stage(api):
    client, fake = api
    pid = client.post("/api/projects", json={}, headers=H(GUEST_A)).json()["id"]
    fake.projects[pid].update(stage="ready", versions=[{"id": "v1", "n": 1}], intake_complete=True,
                              brief={"plot": {"width_ft": 35, "depth_ft": 65, "area_marla": 10.1, "corner": False}, "spaces": [],
                                     "auto_filled": [], "bedrooms": 4})
    p = client.patch(f"/api/projects/{pid}", json={"brief": {"spaces": ["prayer"]}}, headers=H(GUEST_A)).json()
    assert p["stage"] == "ready" and p["brief_changed"] is True


# --- round 2 ---------------------------------------------------------------------------------------------------------------------
def test_share_meta_is_light(api):
    """BE2-05: the client link polls /meta every 30 s: the current version and the list, never the plan or the comments."""
    client, fake = api
    pid, token = _shared_project(client, fake)
    fake.projects[pid]["versions"] = [{"id": "v1", "n": 1, "summary": "37/37 LDA"}, {"id": "v2", "n": 2, "summary": "x"}]
    fake.projects[pid]["current_version_id"] = "v2"
    client.post(f"/api/share/{token}/comments", json={"author_name": "Mr. Khan", "text": "Porch?", "anchor": {}, "camera": {}},
                headers=H(GUEST_B))
    r = client.get(f"/api/share/{token}/meta")
    assert r.status_code == 200
    assert r.json() == {"current_version_id": "v2", "versions": [{"id": "v1", "n": 1}, {"id": "v2", "n": 2}]}
    client.post(f"/api/projects/{pid}/share", json={"enabled": False}, headers=H(GUEST_A))
    assert client.get(f"/api/share/{token}/meta").status_code == 404


def test_general_pins_keep_clear_of_each_other(api):
    """BE2-05: general notes are a quarter of the plot width apart (2.67 m on 35 ft; 0.9 m left pins overlapping at the
    default view); a fifth starts a second row."""
    import math

    client, fake = api
    pid, token = _shared_project(client, fake)
    anchor = {"position": [5.3, 4, -6.6], "normal": [0, 0, 1], "label": "Whole home", "kind": "view"}
    pos = []
    for i in range(6):
        c = client.post(f"/api/share/{token}/comments", json={"author_name": "Mr. Khan", "text": f"Note {i}", "anchor": anchor,
                                                               "camera": {}}, headers=H(GUEST_B)).json()
        pos.append(c["anchor"]["position"])
    assert pos[:4] == [[5.3, 4, -6.6], [7.97, 4, -6.6], [2.63, 4, -6.6], [10.64, 4, -6.6]]
    assert pos[4] == [5.3, 6.4, -6.6] and pos[5] == [7.97, 6.4, -6.6]
    assert min(math.dist(a, b) for i, a in enumerate(pos) for b in pos[i + 1:]) >= 2.4 - 1e-9
    from app import main
    assert main.spread_step(35) == 2.67 and main.spread_step(50) == 3.81 and main.spread_step(10) == 1.6
    # a pin placed near (not exactly on) a taken spot still moves clear
    near = {**anchor, "position": [6.5, 4, -6.6]}
    c = client.post(f"/api/share/{token}/comments", json={"author_name": "Mr. Khan", "text": "Near", "anchor": near, "camera": {}},
                    headers=H(GUEST_B)).json()
    assert all(math.dist(c["anchor"]["position"], q) >= 2.0 - 1e-9 for q in pos)
    # pinned notes (a room or element) are left where they were put
    room = {"position": [5.3, 4, -6.6], "room": "g_lounge"}
    c = client.post(f"/api/share/{token}/comments", json={"author_name": "Mr. Khan", "text": "Lounge", "anchor": room, "camera": {}},
                    headers=H(GUEST_B)).json()
    assert c["anchor"]["position"] == [5.3, 4, -6.6]


# --- round 4 ---------------------------------------------------------------------------------------------------------------------
def test_an_instruction_applies_no_comments_unless_they_are_named(api, monkeypatch):
    """BE-F2: comment_ids given -> exactly those ([] -> none); missing with an instruction -> none (House/Plan Ask, the
    compliance sheet's Fix, Revisions Ask); missing without one -> every open comment on the version (the Next pill)."""
    from app import main
    from app.agents import reviser, reviser_adk

    client, fake = api
    pid, token = _shared_project(client, fake)
    a = client.post(f"/api/share/{token}/comments", json={"author_name": "Bilal", "text": "Wider porch", "anchor": {}, "camera": {}},
                    headers=H(GUEST_B)).json()
    b = client.post(f"/api/share/{token}/comments", json={"author_name": "Bilal", "text": "Hold this one", "anchor": {}, "camera": {}},
                    headers=H(GUEST_B)).json()
    seen = []

    async def fake_revise(p, v, comments, instruction):
        seen.append((sorted(c["id"] for c in comments), instruction))
        yield "stage", {"stage": "changes", "message": reviser.reading_line(comments, instruction)}
    monkeypatch.setattr(reviser_adk, "revise", fake_revise)

    def run(body):
        r = client.post(f"/api/projects/{pid}/revise", json={"version_id": "v1", **body}, headers=H(GUEST_A))
        assert r.status_code == 200, r.text
        main.runs.RUNS.pop(pid, None)
        return r.text

    text = run({"comment_ids": [a["id"]]})                                  # the chooser: exactly the ticked one
    assert seen[-1] == ([a["id"]], None) and "Reading your note…" in text
    text = run({"instruction": "make the master dressing room bigger"})     # typed in Ask: no comments at all
    assert seen[-1] == ([], "make the master dressing room bigger") and "Reading your request…" in text
    run({"comment_ids": [], "instruction": "bigger kitchen"})               # [] means none
    assert seen[-1] == ([], "bigger kitchen")
    run({})                                                                 # the Next pill: every open comment on the version
    assert seen[-1] == (sorted([a["id"], b["id"]]), None)
    assert client.post(f"/api/projects/{pid}/revise", json={"version_id": "v1", "comment_ids": []},
                       headers=H(GUEST_A)).status_code == 400


def _sample(fake):
    fake.projects["p_s"] = {"id": "p_s", "owner": db.SAMPLES_OWNER, "name": "Sample · 10 marla modern home, Johar Town",
                            "members": [], "updated_at": "00000", "versions": [{"id": "v1", "n": 1}]}
    fake.versions["v1"] = {"id": "v1", "n": 1, "plan": {}, "sections": []}


def test_an_untouched_sample_copy_is_reused_and_named_plainly(api):
    """BE-F9: copies drop the "Sample · " prefix; opening the sample again returns the copy while it is untouched."""
    client, fake = api
    _sample(fake)
    a = client.post("/api/projects/p_s/clone", json={}, headers=H(GUEST_A)).json()
    assert a["name"] == "10 marla modern home, Johar Town" and a["cloned_from"] == "p_s"
    assert client.post("/api/projects/p_s/clone", json={}, headers=H(GUEST_A)).json()["id"] == a["id"]


def test_a_renamed_or_commented_copy_gets_a_new_copy(api):
    """BE-F9: once the family has made a copy theirs (renamed it, or commented on it), the sample opens as a new copy, named
    "… (2)", then "… (3)"; the copies stay apart."""
    client, fake = api
    _sample(fake)
    a = client.post("/api/projects/p_s/clone", json={}, headers=H(GUEST_A)).json()
    client.patch(f"/api/projects/{a['id']}", json={"name": "Collab QA final · 10 marla"}, headers=H(GUEST_A))
    b = client.post("/api/projects/p_s/clone", json={}, headers=H(GUEST_A)).json()
    assert b["id"] != a["id"] and b["name"] == "10 marla modern home, Johar Town" and b["cloned_from"] == "p_s"
    # the second copy gets a comment: the next open makes a third, named "(2)" (b holds the plain name)
    client.post(f"/api/projects/{b['id']}/comments", json={"version_id": "v1", "text": "QA note", "anchor": {}, "camera": {}},
                headers=H(GUEST_A))
    c = client.post("/api/projects/p_s/clone", json={}, headers=H(GUEST_A)).json()
    assert c["id"] not in (a["id"], b["id"]) and c["name"] == "10 marla modern home, Johar Town (2)"
    assert client.post("/api/projects/p_s/clone", json={}, headers=H(GUEST_A)).json()["id"] == c["id"]   # untouched: reused
    d = client.post("/api/projects/p_s/clone", json={"fresh": True}, headers=H(GUEST_A)).json()
    assert d["id"] not in (a["id"], b["id"], c["id"]) and d["name"] == "10 marla modern home, Johar Town (3)"
    names = [p["name"] for p in client.get("/api/projects", headers=H(GUEST_A)).json()["projects"]]
    assert len(names) == len(set(names)) == 4


def test_copy_names():
    assert db.copy_base_name("Sample · 1 kanal Spanish villa") == "1 kanal Spanish villa"
    assert db.copy_name("Sample · 1 kanal Spanish villa", set()) == "1 kanal Spanish villa"
    assert db.copy_name("Sample · 1 kanal Spanish villa", {"1 kanal Spanish villa"}) == "1 kanal Spanish villa (2)"
    assert db.copy_name("Sample · V", {"V", "V (2)"}) == "V (3)"
    old = {"name": "Sample · V"}                          # a copy made before copies were renamed is still untouched
    assert not db.renamed(old, {"name": "Sample · V"}) and db.renamed({"name": "Mine"}, {"name": "Sample · V"})
    assert db.renamed({"name": "V (2) ours", "clone_name": "V (2)"}, {"name": "Sample · V"})
