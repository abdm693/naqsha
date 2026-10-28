/** The avatar menu (signed in) or "Sign in" (guest), for the workspace and landing headers. */
import { LogOut } from "lucide-react";
import { cn } from "@/app/lib/utils";
import { useAuth } from "@/app/store/auth";
import { Avatar } from "@/app/ui/Avatar";
import { Button } from "@/app/ui/Button";
import { Menu } from "@/app/ui/Menu";

export function AccountMenu({ className, guestLabel = "Sign in" }: { className?: string; guestLabel?: string }) {
  const user = useAuth((s) => s.user);
  const openAuth = useAuth((s) => s.openAuth);
  const signOut = useAuth((s) => s.signOut);
  if (!user) {
    return (
      <Button variant="quiet" size="sm" className={className} onClick={() => void openAuth({ mode: "signin" })}>
        {guestLabel}
      </Button>
    );
  }
  const name = user.name || user.email.split("@")[0];
  return (
    <Menu
      width={240}
      label="Account"
      trigger={({ open, toggle }) => (
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          aria-haspopup="menu"
          aria-label={`Account: ${name}`}
          className={cn("rounded-full outline-none transition-shadow focus-visible:shadow-focus", open && "shadow-[0_0_0_3px_var(--color-surface-3)]", className)}
        >
          <Avatar name={name} role="owner" size={32} />
        </button>
      )}
      items={[
        { heading: <span className="block truncate"><span className="block text-[14px] font-semibold text-ink">{name}</span><span className="block truncate font-normal">{user.email}</span></span> },
        { separator: true },
        { label: "Sign out", icon: <LogOut />, onSelect: signOut },
      ]}
    />
  );
}
