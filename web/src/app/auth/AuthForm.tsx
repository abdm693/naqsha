/**
 * Email and password sign-in, sign-up and password reset (Google Identity Platform via api/auth.ts).
 * Laid out so a "Continue with Google" button can sit above the fields later (the `providers` slot).
 */
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Eye, EyeOff } from "lucide-react";
import { AuthError } from "@/api/auth";
import { cn } from "@/app/lib/utils";
import { useAuth, type AuthMode, type AuthReason } from "@/app/store/auth";
import { Button } from "@/app/ui/Button";
import { Input } from "@/app/ui/Input";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const AUTH_COPY: Record<AuthReason, { signin: [string, string]; signup: [string, string] }> = {
  save: {
    signup: ["Save your work", "Create a free account to keep your homes and open them on any device."],
    signin: ["Save your work", "Sign in to keep your homes and open them on any device."],
  },
  share: {
    signup: ["Create an account to share", "So the people you invite know who it's from, and can find it again."],
    signin: ["Sign in to share", "So the people you invite know who it's from, and can find it again."],
  },
  invite: {
    signup: ["Join this home", "Create an account with the email your invite was sent to."],
    signin: ["Join this home", "Sign in with the email your invite was sent to."],
  },
  comment: {
    signup: ["Create an account", "Your comments will carry your name."],
    signin: ["Sign in", "Your comments will carry your name."],
  },
  generic: {
    signup: ["Create your account", "Keep your homes, share them, and pick up on any device."],
    signin: ["Welcome back", "Sign in to your homes."],
  },
};

export function AuthForm({
  mode,
  reason = "generic",
  onModeChange,
  providers,
  headingLevel = "h2",
  onDone,
}: {
  mode: AuthMode;
  reason?: AuthReason;
  onModeChange: (m: AuthMode) => void;
  /** Future: "Continue with Google". */
  providers?: ReactNode;
  headingLevel?: "h1" | "h2";
  onDone?: () => void;
}) {
  const signIn = useAuth((s) => s.signIn);
  const signUp = useAuth((s) => s.signUp);
  const resetPassword = useAuth((s) => s.resetPassword);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  // Each field carries its own message, under it; anything else (the network) shows above the button.
  type Field = "name" | "email" | "password";
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [error, setError] = useState<string | null>(null);
  const [focusTick, setFocusTick] = useState(0);
  const [sent, setSent] = useState(false);
  const first = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setError(null);
    setErrors({});
    setSent(false);
    const t = setTimeout(() => first.current?.focus(), 60);
    return () => clearTimeout(t);
  }, [mode]);

  // Take the person straight to the field that needs fixing.
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (focusTick) form.current?.querySelector<HTMLInputElement>('[aria-invalid="true"]')?.focus();
  }, [focusTick]);

  const [title, line] =
    mode === "reset"
      ? ["Reset your password", "We'll email you a link to choose a new one."]
      : AUTH_COPY[reason][mode];
  const H = headingLevel;

  const fail = (msg: string, f: Field | null = null) => {
    if (f) {
      setErrors({ [f]: msg });
      setError(null);
    } else {
      setErrors({});
      setError(msg);
    }
    setFocusTick((n) => n + 1);
  };
  /** Editing a field clears its own message (and nothing else). */
  const edit = (f: Field, set: (v: string) => void) => (v: string) => {
    set(v);
    if (errors[f]) setErrors((e) => ({ ...e, [f]: undefined }));
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const em = email.trim();
    // Every field that needs fixing is marked at once, each with its own message; focus goes to the first.
    const found: Partial<Record<Field, string>> = {};
    if (mode === "signup" && !name.trim()) found.name = "Tell us your name. Clients will see it on what you share.";
    if (!EMAIL.test(em)) found.email = "Enter your email address, like name@example.com.";
    if (mode !== "reset" && !password) found.password = "Enter your password.";
    else if (mode === "signup" && password.length < 6) found.password = "Use at least 6 characters for your password.";
    if (Object.keys(found).length) {
      setErrors(found);
      setError(null);
      setFocusTick((n) => n + 1);
      return;
    }
    setBusy(true);
    setError(null);
    setErrors({});
    try {
      if (mode === "signin") await signIn(em, password);
      else if (mode === "signup") await signUp(name, em, password);
      else {
        await resetPassword(em);
        setSent(true);
        return;
      }
      onDone?.();
    } catch (err) {
      const msg = err instanceof AuthError ? err.message : "Something went wrong. Please try again.";
      const code = err instanceof AuthError ? err.code : "";
      fail(msg, /PASSWORD|CREDENTIALS/.test(code) ? "password" : /EMAIL/.test(code) ? "email" : null);
    } finally {
      setBusy(false);
    }
  };

  if (mode === "reset" && sent) {
    return (
      <div>
        <H className="text-heading text-ink">Check your email</H>
        <p className="mt-1.5 text-[15px] leading-[22px] text-ink-2">
          If <span className="font-medium text-ink">{email.trim()}</span> has an account, a link to reset the password is on its way.
        </p>
        <Button variant="secondary" className="mt-6 w-full" onClick={() => onModeChange("signin")}>
          Back to sign in
        </Button>
      </div>
    );
  }

  return (
    <form ref={form} onSubmit={submit} noValidate>
      <H className="pr-8 text-heading text-ink">{title}</H>
      <p className="mt-1.5 text-[15px] leading-[22px] text-ink-2">{line}</p>

      {providers && mode !== "reset" && <div className="mt-6 flex flex-col gap-2">{providers}</div>}

      <div className="mt-6 flex flex-col gap-3.5">
        {mode === "signup" && (
          <Input
            ref={first}
            label="Your name, as clients will see it"
            autoComplete="name"
            value={name}
            onChange={(e) => edit("name", setName)(e.target.value)}
            placeholder="Ahmed Raza"
            error={errors.name}
            maxLength={60}
          />
        )}
        <Input
          ref={mode === "signup" ? undefined : first}
          label="Email"
          type="email"
          inputMode="email"
          autoComplete="email"
          value={email}
          onChange={(e) => edit("email", setEmail)(e.target.value)}
          placeholder="name@example.com"
          error={errors.email}
        />
        {mode !== "reset" && (
          <Input
            label="Password"
            type={show ? "text" : "password"}
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
            value={password}
            onChange={(e) => edit("password", setPassword)(e.target.value)}
            hint={mode === "signup" ? "At least 6 characters." : undefined}
            error={errors.password}
            trailing={
              <button
                type="button"
                onClick={() => setShow((v) => !v)}
                aria-label={show ? "Hide password" : "Show password"}
                className="grid size-8 place-items-center rounded-full text-ink-3 outline-none transition-colors hover:bg-surface-2 hover:text-ink focus-visible:shadow-focus"
              >
                {show ? <EyeOff className="size-4" strokeWidth={1.75} /> : <Eye className="size-4" strokeWidth={1.75} />}
              </button>
            }
          />
        )}
      </div>

      <div className={cn("overflow-hidden transition-[max-height,opacity] duration-200", error ? "max-h-20 opacity-100" : "max-h-0 opacity-0")}>
        <p role="alert" className="mt-3 text-[13px] font-medium leading-[18px] text-fail">{error}</p>
      </div>

      <Button type="submit" variant="primary" size="lg" className="mt-5 w-full" loading={busy}>
        {mode === "signin" ? "Sign in" : mode === "signup" ? "Create account" : "Send reset link"}
      </Button>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-[14px]">
        {mode === "signin" ? (
          <>
            <span className="text-ink-3">
              New here?{" "}
              <button type="button" className="font-medium text-accent outline-none hover:underline focus-visible:underline" onClick={() => onModeChange("signup")}>
                Create an account
              </button>
            </span>
            <button type="button" className="font-medium text-ink-2 outline-none hover:text-ink focus-visible:underline" onClick={() => onModeChange("reset")}>
              Forgot password?
            </button>
          </>
        ) : mode === "signup" ? (
          <span className="text-ink-3">
            Have an account?{" "}
            <button type="button" className="font-medium text-accent outline-none hover:underline focus-visible:underline" onClick={() => onModeChange("signin")}>
              Sign in
            </button>
          </span>
        ) : (
          <button type="button" className="font-medium text-accent outline-none hover:underline focus-visible:underline" onClick={() => onModeChange("signin")}>
            Back to sign in
          </button>
        )}
      </div>
    </form>
  );
}
