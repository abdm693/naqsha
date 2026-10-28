import { Component, type ErrorInfo, type ReactNode } from "react";
import { cn } from "@/app/lib/utils";

/**
 * Keeps one broken part of the page from blanking the rest. Pass `resetKey` (e.g. the route) to try again
 * automatically when it changes.
 */
export class ErrorBoundary extends Component<
  { children: ReactNode; resetKey?: string; tone?: "light" | "hud"; className?: string; label?: string },
  { error: Error | null }
> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[naqsha] view crashed", error, info.componentStack);
  }

  componentDidUpdate(prev: { resetKey?: string }) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  render() {
    if (!this.state.error) return this.props.children;
    const hud = this.props.tone === "hud";
    return (
      <div className={cn("grid h-full min-h-[240px] w-full place-items-center p-6 text-center", hud ? "bg-hud text-hud-ink" : "bg-canvas text-ink", this.props.className)} role="alert">
        <div className="max-w-sm">
          <p className="text-heading">{this.props.label ?? "This part didn't load"}</p>
          <p className={cn("mt-1.5 text-[15px] leading-[22px]", hud ? "text-hud-ink-2" : "text-ink-2")}>Your work is saved. Try again, or reload the page.</p>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            <button
              type="button"
              onClick={() => this.setState({ error: null })}
              className={cn("h-10 rounded-full px-5 text-[15px] font-medium outline-none focus-visible:shadow-focus", hud ? "bg-hud-ink text-ink" : "bg-ink text-white")}
            >
              Try again
            </button>
            <button
              type="button"
              onClick={() => location.reload()}
              className={cn("h-10 rounded-full border px-5 text-[15px] font-medium outline-none focus-visible:shadow-focus", hud ? "border-white/20 text-hud-ink" : "border-line-strong bg-surface text-ink")}
            >
              Reload
            </button>
            {location.pathname !== "/app" && (
              <a
                href="/app"
                className={cn("inline-flex h-10 items-center rounded-full px-4 text-[15px] font-medium outline-none focus-visible:shadow-focus", hud ? "text-hud-ink hover:bg-white/10" : "text-ink-2 hover:bg-surface-2 hover:text-ink")}
              >
                Back to your homes
              </a>
            )}
          </div>
        </div>
      </div>
    );
  }
}
