/** The sign-in dialog (440px), opened by requireAccount() when saving, sharing or joining. Mounted once in App. */
import { useAuth } from "@/app/store/auth";
import { Dialog } from "@/app/ui/Dialog";
import { AuthForm } from "./AuthForm";

export function AuthDialog() {
  const dialog = useAuth((s) => s.dialog);
  const close = useAuth((s) => s.closeAuth);
  const setMode = useAuth((s) => s.setMode);
  return (
    <Dialog open={dialog.open} onClose={close} width={440} label="Sign in to Naqsha">
      <AuthForm mode={dialog.mode} reason={dialog.reason} onModeChange={setMode} />
      <p className="mt-5 border-t border-line pt-4 text-center text-[13px] leading-[18px] text-ink-3">
        Or keep going as a guest. Your homes stay in this browser.
      </p>
    </Dialog>
  );
}
