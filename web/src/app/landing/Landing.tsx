/**
 * The landing page (/): what Naqsha does for a family or a builder, in plain business language, with the
 * house-under-construction animation, and a separate Portal button into the app (/app).
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion, useReducedMotion } from "motion/react";
import { ArrowRight } from "lucide-react";
import type { Project } from "@contracts/api-types";
import { api, assetUrl } from "@/api/client";
import { cn } from "@/app/lib/utils";
import { heroSample, openSampleHome, sampleCaption, sampleCounts, sampleTitle, type SampleCounts } from "@/app/lib/samples";
import { AccountMenu } from "@/app/auth/AccountMenu";
import { Button, buttonClass } from "@/app/ui/Button";
import { Wordmark } from "@/app/ui/brand";
import { ease } from "@/app/ui/motion";
import { Construction } from "./Construction";

// Hyphenated compounds use U+2011 (a non-breaking hyphen) so "approval‑ready" never splits across lines.
const benefits = (counts: SampleCounts | null): { title: string; line: string }[] => [
  { title: "Plot to a checked floor plan the same afternoon", line: "Tell Naqsha the plot and the family, and get dimensioned floor plans before the chai goes cold." },
  {
    title: "Checked against the bylaws, every time",
    // The counts are the 10 marla sample's own (they move when the rules do); without them, no number is promised.
    line: counts
      ? `Every bylaw that applies to your plot (LDA in this prototype: ${counts.lda} checks on a 10 marla) and ${counts.livable} livable rules: setbacks, coverage, height, stairs to the roof, railings at every drop.`
      : "Every bylaw that applies to your plot (LDA in this prototype), and the livable rules: setbacks, coverage, height, stairs to the roof, railings at every drop.",
  },
  { title: "Start from your own drawing", line: "Have a naqsha from your architect, or a sketch on paper? Upload a photo of it. Naqsha reads every room and builds from your layout, changing only what the rules need." },
  { title: "Rules for your city, looked up for you", line: "Outside Lahore, Naqsha searches the web for your authority's building rules and checks the design against them, with every source linked." },
  { title: "See it from every angle", line: "Photos from the road, the street corner, the garden and the air, each made from the 3D model, so every picture shows the house on the plan." },
  { title: "Walk your home before you build it", line: "Room by room, on any laptop or phone. Find the cramped bedroom while it costs nothing to fix." },
  { title: "Change it by asking", line: "Pin a note on a wall or type what you want. Naqsha returns the next version, still compliant, and answers every note in its thread." },
  { title: "Drawings your contractor can use", line: "Print every floor to scale with a title block, area schedule and compliance sheet, on A3 or A4, or save it as a PDF." },
];

const STEPS: { label: string; time: string; title: string; line: string }[] = [
  { label: "Brief", time: "2 min", title: "Tell Naqsha about the plot", line: "Size, which way it faces, who will live there. One message is enough; Naqsha asks only what it still needs." },
  { label: "Concepts", time: "1 min", title: "Choose a direction", line: "Four exteriors by day and by night. Pick one, and the 3D model is built to match it, feature by feature." },
  { label: "Plan", time: "5 min", title: "See every floor, checked", line: "Dimensioned floors with doors and furniture, checked against LDA and livable rules as they are drawn. Print it for your contractor." },
  { label: "House", time: "5 min", title: "Walk it, change it, share it", line: "Walk through in 3D, pin notes for changes, and bring in your family, your architect or your client." },
];

/** Header links: the same 36px height and 14px type as Sign in and Portal beside them. */
const NAV_LINK = "h-9 items-center rounded-full px-3 text-[14px] font-medium text-ink-2 outline-none transition-colors hover:text-ink focus-visible:shadow-focus";

export function Landing() {
  const navigate = useNavigate();
  const [scrolled, setScrolled] = useState(false);
  const [opening, setOpening] = useState<string | null>(null);
  const [samples, setSamples] = useState<Project[] | null>(null);

  useEffect(() => {
    document.title = "Naqsha · Walk through your home before the first brick";
    const on = () => setScrolled(window.scrollY > 8);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);

  useEffect(() => {
    let alive = true;
    api
      .listSamples()
      .then((list) => alive && setSamples(list))
      .catch(() => alive && setSamples([]));
    return () => {
      alive = false;
    };
  }, []);

  const hero = samples ? heroSample(samples) : undefined;
  const counts = hero ? sampleCounts(hero) : null;

  /** Open one sample (the hero's 10 marla home when no id is given). */
  const sample = async (id?: string) => {
    if (opening) return;
    const target = id ?? hero?.id;
    setOpening(target ?? "hero");
    const ok = await openSampleHome(navigate, target);
    if (!ok) setOpening(null);
  };

  return (
    <div className="min-h-[100dvh] overflow-x-clip bg-canvas text-ink">
      {/* Header */}
      <header
        className={cn(
          "fixed inset-x-0 top-0 z-40 transition-[background-color,box-shadow,backdrop-filter] duration-300",
          scrolled ? "glass-light" : "bg-transparent",
        )}
      >
        <div className="mx-auto flex h-16 max-w-[1280px] items-center justify-between gap-3 px-4 sm:px-8">
          <Link to="/" aria-label="Naqsha home" className="shrink-0 rounded-[8px] outline-none focus-visible:shadow-focus">
            <Wordmark />
          </Link>
          <nav aria-label="Main" className="flex items-center gap-1 sm:gap-2">
            <a href="#how" className={cn(NAV_LINK, "hidden md:inline-flex")}>
              How it works
            </a>
            <a href="#samples" className={cn(NAV_LINK, "hidden md:inline-flex")}>
              Samples
            </a>
            <AccountMenu className="h-9 px-3.5 text-[14px]" />
            <Link to="/app" className={buttonClass("ink", "sm", "h-9 px-4 text-[14px]")}>
              Portal
            </Link>
          </nav>
        </div>
      </header>

      <main>
        {/* Hero */}
        <section
          className="mx-auto grid max-w-[1280px] grid-cols-1 items-center gap-12 px-4 pt-28 sm:px-8 sm:pt-32 lg:min-h-[min(860px,100svh)] lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:gap-16 lg:pb-8 lg:pt-28"
          aria-labelledby="hero-title"
        >
          <div>
            <motion.h1
              id="hero-title"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, ease: ease.out }}
              className="max-w-[12ch] text-[clamp(2.75rem,5.6vw,5.75rem)] font-semibold leading-[.96] tracking-[-.045em] text-ink"
            >
              Walk through your home before the <span className="text-accent">first brick.</span>
            </motion.h1>
            <motion.p
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, ease: ease.out, delay: 0.08 }}
              className="mt-6 max-w-[33rem] text-body-lg text-ink-2 sm:mt-8 sm:text-[19px] sm:leading-[30px]"
            >
              Describe your plot and your family in plain words. Naqsha designs the home like an experienced architect, checks it against your authority's bylaws, and builds it in 3D you can walk through, in minutes.
            </motion.p>
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, ease: ease.out, delay: 0.14 }}
              className="mt-8 flex flex-col gap-3 sm:mt-10 sm:flex-row"
            >
              <Button variant="primary" size="lg" trailing={<ArrowRight className="size-4" strokeWidth={2} />} onClick={() => navigate("/app")}>
                Start your home
              </Button>
              <Button variant="secondary" size="lg" loading={opening === "hero" || (!!hero && opening === hero.id)} onClick={() => void sample()}>
                Explore a sample home
              </Button>
            </motion.div>
            <motion.ul
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.6, ease: ease.out, delay: 0.24 }}
              className="mt-8 flex flex-wrap gap-x-5 gap-y-2 text-[14px] text-ink-3 sm:mt-10"
            >
              {["Design by conversation", "Or upload your drawing", "Bylaw‑checked", "Walk every room"].map((t) => (
                <li key={t} className="flex items-center gap-2">
                  <span className="size-1.5 rounded-full bg-accent" aria-hidden />
                  {t}
                </li>
              ))}
            </motion.ul>
          </div>
          <motion.div
            initial={{ opacity: 0, y: 24, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.9, ease: ease.out, delay: 0.1 }}
          >
            <HeroMedia counts={counts} />
          </motion.div>
        </section>

        {/* Benefits */}
        <section className="mx-auto max-w-[1280px] px-4 pt-28 sm:px-8 sm:pt-36" aria-labelledby="benefits-title">
          <SectionHead
            id="benefits-title"
            title="Everything between the plot and the contractor."
            line="What used to take weeks of sketches and site visits now fits in one sitting with your family."
          />
          <ul className="mt-14 grid grid-cols-1 gap-x-10 gap-y-12 sm:grid-cols-2 lg:grid-cols-4">
            {benefits(counts).map((b, i) => (
              <Reveal key={b.title} delay={(i % 3) * 0.06} as="li">
                <div className="h-px w-10 bg-ink" aria-hidden />
                {/* Two lines reserved: a title that wraps never pushes its body below its neighbours'. */}
                <h3 className="mt-5 text-heading text-ink sm:min-h-[2lh]">{b.title}</h3>
                <p className="mt-2 text-[15px] leading-[24px] text-ink-2">{b.line}</p>
              </Reveal>
            ))}
          </ul>
        </section>

        {/* How it works */}
        <section id="how" className="mx-auto max-w-[1280px] scroll-mt-24 px-4 pt-28 sm:px-8 sm:pt-36" aria-labelledby="how-title">
          <div className="rounded-media bg-surface px-5 py-14 shadow-e1 sm:px-12 sm:py-20">
            <SectionHead id="how-title" title="How it works" line="Four views of one home, one conversation. You can stop at any point and come back." />
            <ol className="mt-14 grid grid-cols-1 gap-10 md:grid-cols-2 md:gap-8 lg:grid-cols-4">
              {STEPS.map((s, i) => (
                <Reveal key={s.label} delay={i * 0.08} as="li" className="relative">
                  <div className="flex items-center gap-3">
                    <span className="text-[13px] font-semibold text-accent">{s.label}</span>
                    <span className="h-px flex-1 bg-line" aria-hidden />
                    <span className="tabular text-[12px] font-medium text-ink-3">{s.time}</span>
                  </div>
                  <h3 className="mt-5 text-heading text-ink">{s.title}</h3>
                  <p className="mt-2 text-[15px] leading-[24px] text-ink-2">{s.line}</p>
                </Reveal>
              ))}
            </ol>
          </div>
        </section>

        {/* Samples */}
        <section id="samples" className="mx-auto max-w-[1280px] scroll-mt-24 px-4 pt-28 sm:px-8 sm:pt-36" aria-labelledby="samples-title">
          <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
            <SectionHead id="samples-title" title="Sample homes" line="Open a finished home and walk through it. No account needed." />
            {!!hero && (
              <Button variant="secondary" className="self-start sm:self-auto" loading={opening === hero.id} onClick={() => void sample(hero.id)} trailing={<ArrowRight className="size-4" strokeWidth={1.75} />}>
                Walk through one
              </Button>
            )}
          </div>
          {samples === null ? (
            <ul className="mt-12 grid grid-cols-1 gap-x-6 gap-y-10 sm:grid-cols-2" aria-label="Loading sample homes" aria-busy>
              {[0, 1].map((i) => (
                <li key={i} className="flex flex-col gap-3">
                  <div className="relative aspect-[4/3] overflow-hidden rounded-card bg-surface-2">
                    <div className="absolute inset-0 -translate-x-full animate-shimmer bg-gradient-to-r from-transparent via-white/60 to-transparent" />
                  </div>
                  <div className="h-4 w-2/3 rounded-full bg-surface-2" />
                  <div className="h-3 w-1/2 rounded-full bg-surface-2" />
                </li>
              ))}
            </ul>
          ) : samples.length ? (
            <ul className={cn("mt-12 grid grid-cols-1 gap-x-6 gap-y-10 sm:grid-cols-2", samples.length > 2 && "lg:grid-cols-3")}>
              {/* The home the hero animates comes first. */}
              {[...samples].sort((a, b) => Number(b.id === hero?.id) - Number(a.id === hero?.id)).map((s, i) => {
                const img = assetUrl(s.thumbnail_url);
                return (
                  <Reveal key={s.id} delay={i * 0.06} as="li">
                    <button
                      type="button"
                      onClick={() => void sample(s.id)}
                      disabled={!!opening}
                      aria-busy={opening === s.id || undefined}
                      className="group/s block w-full text-left outline-none disabled:cursor-progress"
                      aria-label={`Explore the sample home: ${sampleTitle(s.name)}`}
                    >
                      <span className="relative block overflow-hidden rounded-card bg-surface-2 shadow-e1 transition-[box-shadow,transform] duration-[600ms] ease-out group-hover/s:-translate-y-0.5 group-hover/s:shadow-e2 group-focus-visible/s:shadow-focus">
                        {img ? (
                          <img src={img} alt="" loading="lazy" className="aspect-[4/3] w-full object-cover transition-transform duration-[600ms] ease-out group-hover/s:scale-[1.02]" />
                        ) : (
                          <span className="block aspect-[4/3] w-full" />
                        )}
                        {opening === s.id && (
                          <span className="glass-light absolute left-3 top-3 inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-[12px] font-medium text-ink">
                            <span className="size-1.5 animate-breathe rounded-full bg-accent" aria-hidden />
                            Opening
                          </span>
                        )}
                      </span>
                      <span className="mt-3 block px-0.5 text-[15px] font-semibold tracking-[-.01em] text-ink">{sampleTitle(s.name)}</span>
                      <span className="block px-0.5 text-[13px] text-ink-3">{sampleCaption(s)}</span>
                    </button>
                  </Reveal>
                );
              })}
            </ul>
          ) : (
            <p className="mt-12 rounded-card bg-surface px-6 py-10 text-center text-[15px] text-ink-2 shadow-e1">
              The sample homes are resting right now. <Link to="/app" className="font-medium text-ink underline underline-offset-4">Start your own</Link> instead.
            </p>
          )}
        </section>

        {/* For builders */}
        <section className="mx-auto max-w-[1280px] px-4 pt-28 sm:px-8 sm:pt-36" aria-labelledby="builders-title">
          <div className="flex flex-col items-start gap-8 rounded-media bg-ink px-6 py-14 text-white sm:px-12 sm:py-20 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-[40rem]">
              <h2 id="builders-title" className="text-[32px]/[38px] font-semibold tracking-[-.03em] sm:text-display">
                For builders and architects: win the client in the first meeting.
              </h2>
              <p className="mt-4 text-body-lg text-white/70">
                Arrive with a laptop. Leave with a walkable design the family has already commented on, and a link they can share with everyone who has a say.
              </p>
            </div>
            <Link to="/app" className={buttonClass("secondary", "lg", "border-transparent bg-white text-ink hover:bg-white/90")}>
              Portal
              <ArrowRight className="size-4" strokeWidth={2} />
            </Link>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="mx-auto mt-28 max-w-[1280px] px-4 pb-12 sm:mt-36 sm:px-8">
        <div className="flex flex-col gap-8 border-t border-line pt-10 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <Wordmark />
            <p className="mt-3 max-w-xs text-[14px] leading-[22px] text-ink-3">Homes designed with you, checked against your city's rules, and ready to walk.</p>
          </div>
          <nav aria-label="Footer" className="grid grid-cols-2 gap-x-12 text-[14px]">
            <Link to="/app" className="inline-flex min-h-11 items-center text-ink-2 hover:text-ink sm:min-h-8">Portal</Link>
            <a href="#how" className="inline-flex min-h-11 items-center text-ink-2 hover:text-ink sm:min-h-8">How it works</a>
            <a href="#samples" className="inline-flex min-h-11 items-center text-ink-2 hover:text-ink sm:min-h-8">Samples</a>
            <Link to="/app/signin" className="inline-flex min-h-11 items-center text-ink-2 hover:text-ink sm:min-h-8">Sign in</Link>
          </nav>
        </div>
        <p className="mt-10 text-[13px] text-ink-3">© 2026 Naqsha · Made in Lahore · Designed by NVIDIA Nemotron on Nebius Token Factory · Open source (AGPL‑3.0)</p>
      </footer>
    </div>
  );
}

/**
 * The hero frame: Naqsha's 2D drawing of a home (plot, structure, walls, render, night) plays first, then hands over
 * to the 3D film of a sample home being built in the viewer (a real capture, looped).
 */
function HeroMedia({ counts }: { counts: SampleCounts | null }) {
  const reduce = useReducedMotion();
  const [stage, setStage] = useState<"draw" | "build">(reduce ? "build" : "draw");
  const film = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (stage !== "build" || reduce) return;
    const v = film.current;
    if (!v) return;
    v.currentTime = 0;
    void v.play().catch(() => {});
  }, [stage, reduce]);

  const label = "A sample home being built in 3D by Naqsha, from the plot to the finished house at night";
  return (
    <figure className="relative mx-auto w-full max-w-[640px]">
      <div className="relative aspect-square overflow-hidden rounded-media bg-surface shadow-e3">
        {reduce ? (
          <img src="/hero/naqsha-build-poster.jpg" alt={label} className="size-full object-cover" />
        ) : (
          <>
            <video
              ref={film}
              className={cn("absolute inset-0 size-full object-cover transition-opacity duration-1000 ease-out", stage === "build" ? "opacity-100" : "opacity-0")}
              muted
              loop
              playsInline
              preload="auto"
              poster="/hero/naqsha-build-poster.jpg"
              aria-label={label}
            >
              <source src="/hero/naqsha-build-720.mp4" type="video/mp4" media="(max-width: 767px)" />
              <source src="/hero/naqsha-build.webm" type="video/webm" />
              <source src="/hero/naqsha-build.mp4" type="video/mp4" />
            </video>
            <div
              className={cn(
                "absolute inset-0 flex items-center bg-surface transition-opacity duration-1000 ease-out",
                stage === "draw" ? "opacity-100" : "pointer-events-none opacity-0",
              )}
              style={{
                backgroundImage:
                  "linear-gradient(rgb(17 17 19 / .045) 1px, transparent 1px), linear-gradient(90deg, rgb(17 17 19 / .045) 1px, transparent 1px)",
                backgroundSize: "24px 24px",
              }}
              aria-hidden={stage !== "draw"}
            >
              <Construction className="w-full rounded-none bg-transparent shadow-none" counts={counts} hideReplay onDone={() => setStage("build")} />
            </div>
          </>
        )}
        <div className="pointer-events-none absolute inset-0 rounded-media ring-1 ring-inset ring-black/5" aria-hidden />
      </div>
      <figcaption
        className={cn(
          "absolute left-4 top-4 flex items-center gap-2 rounded-full bg-white/85 px-3 py-1.5 text-[13px] font-medium text-ink shadow-e1 backdrop-blur transition-opacity duration-700 sm:left-5 sm:top-5",
          stage === "build" ? "opacity-100" : "opacity-0",
        )}
      >
        <span className="size-1.5 rounded-full bg-accent" aria-hidden />
        A sample home, built in 3D by Naqsha
      </figcaption>
    </figure>
  );
}

function SectionHead({ id, title, line }: { id: string; title: string; line: string }) {
  return (
    <Reveal className="max-w-[44rem]">
      <h2 id={id} className="text-[32px]/[38px] font-semibold tracking-[-.03em] text-ink sm:text-display">{title}</h2>
      <p className="mt-4 text-body-lg text-ink-2">{line}</p>
    </Reveal>
  );
}

/** Fades content up once as it scrolls into view. */
function Reveal({ children, delay = 0, className, as = "div" }: { children: ReactNode; delay?: number; className?: string; as?: "div" | "li" }) {
  const Comp = as === "li" ? motion.li : motion.div;
  return (
    <Comp
      initial={{ opacity: 0, y: 14 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ duration: 0.6, ease: ease.out, delay }}
      className={className}
    >
      {children}
    </Comp>
  );
}
