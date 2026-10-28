/**
 * One Share dialog (contracts/api.md "Sharing UX"): invite by email as Team or Client, the people who already have
 * access with a role menu and Remove, and the client link ("Anyone with the link can view and comment") with Copy.
 */
import { useEffect, useId, useState, type FormEvent } from "react";
import { ChevronDown, Link2, Mail } from "lucide-react";
import type { Member, Project, Role } from "@contracts/api-types";
import { shareUrl } from "@/api/client";
import { copyText } from "@/app/lib/hooks";
import { cn } from "@/app/lib/utils";
import { requireAccount, useAuth } from "@/app/store/auth";
import { useMembers } from "@/app/store/members";
import { toast } from "@/app/store/toast";
import { Avatar } from "@/app/ui/Avatar";
import { Button } from "@/app/ui/Button";
import { Dialog } from "@/app/ui/Dialog";
import { Input } from "@/app/ui/Input";
import { Menu } from "@/app/ui/Menu";
import { Segmented } from "@/app/ui/Segmented";
import { Spinner } from "@/app/ui/Spinner";
import { Switch } from "@/app/ui/Switch";

type Invitable = Exclude<Role, "owner">;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ROLE_NAME: Record<Role, string> = { owner: "Owner", team: "Team", client: "Client" };

export function ShareDialog({ open, onClose, project }: { open: boolean; onClose: () => void; project: Project }) {
  const user = useAuth((s) => s.user);
  const { members, share, status, load, invite, setRole, remove, setShare } = useMembers();
  const [email, setEmail] = useState("");
  const [role, setRoleChoice] = useState<Invitable>("client");
  const [error, setError] = useState<string | null>(null);
  const [inviting, setInviting] = useState(false);
  const [toggling, setToggling] = useState(false);
  const switchId = useId();

  useEffect(() => {
    if (open) void load(project.id);
  }, [open, project.id, load]);
  useEffect(() => {
    if (!open) { setEmail(""); setError(null); }
  }, [open]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const v = email.trim();
    if (!EMAIL.test(v)) { setError("Enter an email address, like name@example.com."); return; }
    if (user && v.toLowerCase() === user.email.toLowerCase()) { setError("That's you. You already own this home."); return; }
    setError(null);
    setInviting(true);
    const ok = await invite(v, role);
    setInviting(false);
    if (ok) setEmail("");
  };

  const url = shareUrl(share);
  const copy = async () => {
    if (!url) return;
    toast.show((await copyText(url)) ? "Link copied" : "Couldn't copy. Select the link and copy it.");
  };
  const toggleLink = async (on: boolean) => {
    setToggling(true);
    const link = await setShare(on);
    setToggling(false);
    if (on && link && (await copyText(link))) toast.show("Client link is on, and copied");
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Share this home"
      description={user ? "Invite your team to design with you, or send your client a link." : "Send your client a link to view and comment. No account needed for that."}
      width={520}
      actions={<Button variant="secondary" onClick={onClose}>Done</Button>}
    >
      {user ? (
        <>
          {/* Invite */}
          <form onSubmit={submit} className="flex flex-col gap-2.5" noValidate>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                type="email"
                inputMode="email"
                autoComplete="email"
                placeholder="name@example.com"
                aria-label="Email to invite"
                value={email}
                onChange={(e) => { setEmail(e.target.value); setError(null); }}
                error={error ?? undefined}
                leading={<Mail className="size-4" strokeWidth={1.75} />}
                wrapperClassName="flex-1"
                data-autofocus
              />
              <div className="flex gap-2">
                <Segmented<Invitable>
                  label="Invite as"
                  value={role}
                  onChange={setRoleChoice}
                  options={[{ value: "team", label: "Team" }, { value: "client", label: "Client" }]}
                  className="h-11 p-1 [&>button]:px-3.5"
                />
                <Button type="submit" variant="primary" className="h-11 px-5" loading={inviting} disabled={!email.trim()}>
                  Invite
                </Button>
              </div>
            </div>
            <p className="text-[12px] leading-4 text-ink-3">
              {role === "team" ? "Team can design, comment and run revisions." : "Clients can view the plan and 3D, walk through, and comment."}
            </p>
          </form>

          {/* People */}
          <div className="mt-5">
            <p className="mb-1 text-[13px] font-medium text-ink-2">People with access</p>
            <ul className="flex flex-col">
              {user && (
                <PersonRow name={user.name || user.email.split("@")[0]} email={user.email} role="owner" you />
              )}
              {members.map((m) => (
                <PersonRow
                  key={m.email}
                  name={m.name}
                  email={m.email}
                  role={m.role}
                  invited={m.status === "invited"}
                  onRole={(r) => void setRole(m.email, r)}
                  onRemove={() => void remove(m.email)}
                />
              ))}
              {status === "loading" && members.length === 0 && (
                <li className="flex items-center gap-2 py-3 text-[13px] text-ink-3"><Spinner /> Loading people…</li>
              )}
            </ul>
          </div>

        </>
      ) : null}

      {/* Client link */}
      <div className={cn("rounded-[16px]", user && "mt-5", "bg-canvas p-4 shadow-[inset_0_0_0_1px_var(--color-line)]")}>
        <div className="flex items-start gap-3">
          <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-full bg-surface text-ink-2 shadow-e1">
            <Link2 className="size-4" strokeWidth={1.75} />
          </span>
          <label htmlFor={switchId} className="min-w-0 flex-1 cursor-pointer">
            <span className="block text-[14px] font-semibold text-ink">Client link</span>
            <span className="block text-[13px] leading-[18px] text-ink-3">Anyone with the link can view and comment.</span>
          </label>
          {/* Until /members answers, the link's state isn't known: a spinner, never a switch that reads "off". */}
          {status === "loading" || status === "idle" ? (
            <span className="grid h-6 w-10 shrink-0 place-items-center" role="status" aria-label="Checking the client link">
              <Spinner />
            </span>
          ) : (
            <Switch id={switchId} checked={share.enabled} onChange={(on) => void toggleLink(on)} disabled={toggling} />
          )}
        </div>
        {share.enabled && url && (
          <div className="mt-3 flex items-center gap-2">
            <input
              readOnly
              value={url.replace(/^https?:\/\//, "")}
              aria-label="Client link"
              onFocus={(e) => e.currentTarget.select()}
              className="h-10 min-w-0 flex-1 truncate rounded-control border border-line bg-surface px-3 text-[13px] text-ink-2 outline-none focus:border-accent focus:shadow-focus"
            />
            <Button variant="ink" size="md" onClick={() => void copy()}>Copy link</Button>
          </div>
        )}
      </div>

      {/* Invite by email needs an account, so people know who invited them. A guest is asked here, inline. */}
      {!user && (
        <div className="mt-3 flex flex-col gap-3 rounded-[16px] p-4 shadow-[inset_0_0_0_1px_var(--color-line)] sm:flex-row sm:items-center">
          <span className="grid size-8 shrink-0 place-items-center rounded-full bg-surface-2 text-ink-2">
            <Mail className="size-4" strokeWidth={1.75} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[14px] font-semibold text-ink">Invite by email</p>
            <p className="text-[13px] leading-[18px] text-ink-3">Bring in your team to design, or invite a client by name. Invites need a free account.</p>
          </div>
          <Button variant="secondary" size="sm" className="self-start sm:self-auto" onClick={() => void requireAccount("invite")}>
            Create an account
          </Button>
        </div>
      )}
    </Dialog>
  );
}

function PersonRow({
  name,
  email,
  role,
  you,
  invited,
  onRole,
  onRemove,
}: {
  name?: string;
  email: string;
  role: Member["role"];
  you?: boolean;
  invited?: boolean;
  onRole?: (r: Invitable) => void;
  onRemove?: () => void;
}) {
  const display = name || email.split("@")[0];
  return (
    <li className="flex min-h-14 items-center gap-3 border-b border-line py-2 last:border-b-0">
      <Avatar name={display} role={role} size={32} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[14px] font-medium text-ink">
          {display}
          {you && <span className="font-normal text-ink-3"> (you)</span>}
        </p>
        <p className="truncate text-[12px] text-ink-3">
          {email}
          {invited && " · Invited"}
        </p>
      </div>
      {you || !onRole ? (
        <span className="pr-2 text-[13px] text-ink-3">{ROLE_NAME[role]}</span>
      ) : (
        <Menu
          width={248}
          label={`Access for ${display}`}
          trigger={({ open, toggle }) => (
            <button
              type="button"
              onClick={toggle}
              aria-expanded={open}
              aria-haspopup="menu"
              className={cn(
                "inline-flex h-8 items-center gap-1 rounded-full px-3 text-[13px] font-medium text-ink-2 outline-none transition-colors hover:bg-surface-2 hover:text-ink focus-visible:shadow-focus",
                open && "bg-surface-2",
              )}
            >
              {ROLE_NAME[role]}
              <ChevronDown className="size-3.5" strokeWidth={1.75} />
            </button>
          )}
          items={[
            { label: "Team", hint: "Design and revise", checked: role === "team", onSelect: () => role !== "team" && onRole("team") },
            { label: "Client", hint: "View and comment", checked: role === "client", onSelect: () => role !== "client" && onRole("client") },
            { separator: true },
            { label: "Remove", danger: true, onSelect: () => onRemove?.() },
          ]}
        />
      )}
    </li>
  );
}
