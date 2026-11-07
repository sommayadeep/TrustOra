import type { ReactNode } from "react";
import { ExternalLink } from "lucide-react";
import { STATE_LABEL, STATE_TONE, arcTxUrl, shortHash } from "@/lib/format";

const cx = (...parts: Array<string | false | undefined>) => parts.filter(Boolean).join(" ");

/* ---------------------------------------------------------------- surfaces */

/**
 * The default page surface: flat white on warm paper with a hairline rule.
 * `tone="glass"` is for floating layers only (overlays, wallet panels, sticky rails),
 * never for a grid of content cards.
 */
export function Card({
  children,
  className = "",
  tone = "plain",
  hover = false,
}: {
  children: ReactNode;
  className?: string;
  tone?: "plain" | "quiet" | "glass";
  hover?: boolean;
}) {
  const base =
    tone === "glass" ? "glass glass-sheen" : tone === "quiet" ? "surface-quiet" : "surface";
  return (
    <section className={cx(base, hover && "surface-hover", "rounded-md p-5 sm:p-6", className)}>
      {children}
    </section>
  );
}

/** A floating glass layer: menus, wallet panels, contextual overlays. */
export function GlassPanel({ children, className = "", strong = false }: { children: ReactNode; className?: string; strong?: boolean }) {
  return <div className={cx(strong ? "glass-strong" : "glass", "glass-sheen rounded-md", className)}>{children}</div>;
}

/** A hairline divider, optionally carrying a small label in the rule. */
export function Rule({ label, className = "" }: { label?: string; className?: string }) {
  if (!label) return <hr className={cx("border-0 border-t border-rule", className)} />;
  return (
    <div className={cx("flex items-center gap-4", className)}>
      <span className="eyebrow shrink-0">{label}</span>
      <span className="h-px flex-1 bg-rule" />
    </div>
  );
}

/* ------------------------------------------------------------------- type */

/**
 * Editorial page header. The eyebrow, title and lede sit on an asymmetric
 * measure so the page does not read as a centred template.
 */
export function PageHeader({
  eyebrow,
  title,
  lede,
  aside,
  size = "lg",
}: {
  eyebrow?: string;
  title: ReactNode;
  lede?: ReactNode;
  aside?: ReactNode;
  size?: "lg" | "md";
}) {
  return (
    <header className="mb-10 grid gap-6 lg:grid-cols-12 lg:items-end">
      <div className="lg:col-span-8">
        {eyebrow && <p className="eyebrow mb-3">{eyebrow}</p>}
        <h1 className={cx("display", size === "lg" ? "display-lg" : "display-md", "text-ink")}>{title}</h1>
        {lede && <p className="lede mt-4 max-w-prose">{lede}</p>}
      </div>
      {aside && <div className="lg:col-span-4 lg:justify-self-end">{aside}</div>}
    </header>
  );
}

/** Monospaced reference: a hash, account id or request id. Never wraps mid-token. */
export function Mono({ children, className = "", title }: { children: ReactNode; className?: string; title?: string }) {
  return (
    <span className={cx("mono break-all text-[0.8125rem] text-ink-2", className)} title={title}>
      {children}
    </span>
  );
}

/** A large figure with its label, for ledgers and metric rails. */
export function Figure({ label, value, unit, tone = "ink" }: { label: string; value: ReactNode; unit?: string; tone?: "ink" | "ok" | "royal" }) {
  const color = tone === "ok" ? "text-ok" : tone === "royal" ? "text-royal" : "text-ink";
  return (
    <div>
      <p className="eyebrow">{label}</p>
      <p className={cx("display display-md mt-2 tnum", color)}>
        {value}
        {unit && <span className="ml-1.5 align-baseline text-base font-medium tracking-normal text-ink-3">{unit}</span>}
      </p>
    </div>
  );
}

/* ---------------------------------------------------------------- controls */

const BTN: Record<string, string> = {
  primary: "bg-royal text-white hover:bg-royal-deep shadow-soft",
  secondary: "bg-surface text-ink border border-rule-strong hover:border-ink-3",
  quiet: "bg-transparent text-ink-2 hover:bg-surface-2",
  neu: "neu neu-press text-ink",
  danger: "bg-risk-wash text-risk border border-risk/25 hover:bg-risk/10",
};

/** Buttons press slightly on click; the tactile feel is the only ornament. */
export function Button({
  children,
  variant = "primary",
  size = "md",
  className = "",
  ...rest
}: {
  children: ReactNode;
  variant?: "primary" | "secondary" | "quiet" | "neu" | "danger";
  size?: "sm" | "md";
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...rest}
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-sm font-medium transition-all duration-150",
        "active:translate-y-px disabled:cursor-not-allowed disabled:opacity-45 disabled:active:translate-y-0",
        size === "sm" ? "px-3 py-1.5 text-xs" : "px-4 py-2.5 text-sm",
        BTN[variant],
        className,
      )}
    >
      {children}
    </button>
  );
}

/** Neumorphic switch with a thumb that slides. Renders as a real checkbox for a11y. */
export function Toggle({
  checked,
  onChange,
  label,
  disabled = false,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <label className={cx("inline-flex cursor-pointer items-center gap-3", disabled && "cursor-not-allowed opacity-50")}>
      <span className="relative inline-flex h-6 w-11 shrink-0 items-center">
        <input
          type="checkbox"
          role="switch"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
          className="peer sr-only"
        />
        <span
          aria-hidden
          className={cx(
            "absolute inset-0 rounded-full transition-colors duration-200",
            checked ? "bg-royal shadow-[inset_0_1px_3px_rgba(23,36,58,.25)]" : "neu-inset",
          )}
        />
        <span
          aria-hidden
          className={cx(
            "absolute left-0.5 h-5 w-5 rounded-full bg-white shadow-soft transition-transform duration-200",
            checked && "translate-x-5",
          )}
        />
      </span>
      <span className="text-sm text-ink-2">{label}</span>
    </label>
  );
}

/** Segmented control. The active segment is a sliding white chip inside an inset groove. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: Array<{ value: T; label: string }>;
  value: T;
  onChange: (next: T) => void;
  ariaLabel: string;
}) {
  const index = Math.max(0, options.findIndex((o) => o.value === value));
  return (
    <div role="tablist" aria-label={ariaLabel} className="neu-inset relative inline-flex rounded-sm p-1">
      <span
        aria-hidden
        className="absolute inset-y-1 rounded-[6px] bg-white shadow-soft transition-transform duration-200"
        style={{ width: `calc((100% - 0.5rem) / ${options.length})`, transform: `translateX(calc(${index} * 100%))`, left: "0.25rem" }}
      />
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={o.value === value}
          onClick={() => onChange(o.value)}
          className={cx(
            "relative z-10 flex-1 whitespace-nowrap rounded-[6px] px-3.5 py-1.5 text-xs font-medium transition-colors duration-150",
            o.value === value ? "text-ink" : "text-ink-3 hover:text-ink-2",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ----------------------------------------------------------------- status */

export function StateBadge({ state }: { state: string }) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium",
        STATE_TONE[state] ?? STATE_TONE.UNFUNDED,
      )}
    >
      {STATE_LABEL[state] ?? state}
    </span>
  );
}

/** A transaction hash that links to the Arc explorer. */
export function TxLink({ hash, label }: { hash: string; label?: string }) {
  return (
    <a
      href={arcTxUrl(hash)}
      target="_blank"
      rel="noreferrer"
      className="mono inline-flex items-center gap-1.5 text-xs text-royal underline-offset-2 transition-colors hover:text-royal-deep hover:underline"
      title={hash}
    >
      {label ? `${label}: ` : ""}
      {shortHash(hash)}
      <ExternalLink className="h-3 w-3 shrink-0" />
    </a>
  );
}

/* ------------------------------------------------------------ empty/loading */

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="surface-quiet rounded-md px-8 py-14 text-center">
      <p className="display display-md text-ink">{title}</p>
      {children && <div className="mx-auto mt-3 max-w-md text-sm leading-6 text-ink-2">{children}</div>}
    </div>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={cx("shimmer rounded-sm", className)} aria-hidden />;
}

/** Loading placeholder shaped like the content it replaces, so the page does not jump. */
export function PageSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-4" role="status" aria-label="Loading">
      <Skeleton className="h-9 w-64" />
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-24 w-full" />
      ))}
    </div>
  );
}

/** Error state with a retry, so a failed request is recoverable without reloading the page. */
export function ErrorState({ title, message, onRetry }: { title: string; message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="surface rounded-md px-8 py-12 text-center">
      <p className="display display-md text-ink">{title}</p>
      <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-ink-3">{message}</p>
      {onRetry && (
        <Button variant="secondary" onClick={onRetry} className="mt-5">
          Try again
        </Button>
      )}
    </div>
  );
}
