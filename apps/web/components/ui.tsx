// SPDX-License-Identifier: AGPL-3.0-only
// The shared pieces.
//
// The building blocks: buttons, fields, bars, cards, pills and the page frame.
//
// Wherever UI SDK ships the control, this file is only its Aeyhey styling: Button, Field,
// Input, Textarea, Meter and Progress below are UI SDK's, dressed. Cards, pills and the
// page frame have no behaviour to borrow, so they are plain markup. The controls with
// more parts (selects, switches, password fields) are in form.tsx.
// Two rules run through all of it:
//   - every control is at least 44px tall, because this is used one-handed on a phone
//   - colour is never the only signal; a status always carries a word too (PRD 12.4)

import type { ComponentProps, ReactNode } from "react";
import { Button as SdkButton } from "@ui-sdk/react/button";
import { Field as SdkField, FieldDescription, FieldError, FieldLabel } from "@ui-sdk/react/field";
import { Input as SdkInput } from "@ui-sdk/react/input";
import { Meter, MeterIndicator, MeterTrack } from "@ui-sdk/react/meter";
import { Progress, ProgressIndicator, ProgressTrack } from "@ui-sdk/react/progress";
import { Textarea as SdkTextarea } from "@ui-sdk/react/textarea";
import { ChevronLeft } from "lucide-react";
import type { LucideIcon } from "./icons";
import { LinkButtonRoot } from "./link-button-root";

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

// ---------------------------------------------------------------- button

export type ButtonTone = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

const TONES: Record<ButtonTone, string> = {
  primary:
    "bg-primary text-primary-foreground hover:bg-primary-hover shadow-card active:shadow-pressed",
  secondary:
    "bg-surface text-foreground border border-border hover:border-border-strong hover:bg-raised shadow-card",
  ghost: "text-muted-foreground hover:text-foreground hover:bg-sunken",
  danger: "bg-danger text-white hover:opacity-90 shadow-card",
};

const SIZES: Record<ButtonSize, string> = {
  sm: "min-h-9 px-3 text-xs gap-1.5 rounded-lg",
  md: "min-h-11 px-4 text-sm gap-2 rounded-lg",
  lg: "min-h-13 px-6 text-base gap-2.5 rounded-xl",
};

export function Button({
  children,
  tone = "secondary",
  size = "md",
  icon,
  iconRight,
  shortcut,
  fullWidth,
  className,
  type = "button",
  ...rest
}: {
  children?: ReactNode;
  tone?: ButtonTone;
  size?: ButtonSize;
  icon?: LucideIcon;
  iconRight?: LucideIcon;
  /**
   * The visual shortcut hint. Hidden from the accessibility tree so the button's name
   * stays just its label: a screen reader announcing "Again 1" is worse than one that
   * announces "Again" and reports the shortcut through aria-keyshortcuts.
   */
  shortcut?: string;
  fullWidth?: boolean;
} & Omit<ComponentProps<typeof SdkButton>, "children" | "className"> & { className?: string }) {
  const IconLeft = icon;
  const IconRight = iconRight;
  const iconSize = size === "lg" ? 18 : size === "sm" ? 14 : 16;

  return (
    <SdkButton
      type={type}
      className={cx(
        "inline-flex cursor-pointer items-center justify-center font-semibold transition-all duration-150",
        "data-disabled:pointer-events-none data-disabled:opacity-45 data-pending:cursor-progress",
        TONES[tone],
        SIZES[size],
        fullWidth && "w-full",
        className,
      )}
      {...(shortcut ? { "aria-keyshortcuts": shortcut } : {})}
      {...rest}
    >
      {IconLeft ? <IconLeft size={iconSize} aria-hidden="true" className="shrink-0" /> : null}
      {children}
      {IconRight ? <IconRight size={iconSize} aria-hidden="true" className="shrink-0" /> : null}
      {shortcut ? (
        <kbd
          aria-hidden="true"
          className="border-border-strong/60 bg-canvas/40 ml-0.5 hidden rounded border px-1.5 py-px font-sans text-[10px] font-semibold opacity-70 sm:inline"
        >
          {shortcut}
        </kbd>
      ) : null}
    </SdkButton>
  );
}

// ---------------------------------------------------------------- surfaces

export function Card({
  children,
  className,
  interactive,
  padding = "md",
}: {
  children: ReactNode;
  className?: string;
  /** Adds the hover lift. Only for a card that is itself a link or a button. */
  interactive?: boolean;
  padding?: "none" | "sm" | "md" | "lg";
}) {
  const pad = { none: "", sm: "p-3.5", md: "p-5", lg: "p-6 sm:p-7" }[padding];

  return (
    <div
      className={cx(
        "bg-surface border-border shadow-card rounded-xl border",
        pad,
        interactive && "lift cursor-pointer",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <h2 className="text-subtle-foreground text-2xs font-bold uppercase tracking-[0.08em]">
      {children}
    </h2>
  );
}

// ---------------------------------------------------------------- status

export function Tag({ children, onClick }: { children: ReactNode; onClick?: () => void }) {
  const className =
    "bg-sunken text-muted-foreground inline-flex items-center rounded-md px-2 py-0.5 text-2xs font-medium";

  if (!onClick) return <span className={className}>{children}</span>;
  return (
    <SdkButton onClick={onClick} className={cx(className, "hover:text-foreground cursor-pointer")}>
      {children}
    </SdkButton>
  );
}

const STATUS_STYLES: Record<string, { className: string; label: string }> = {
  unread: { className: "bg-primary-soft text-primary", label: "Unread" },
  snoozed: { className: "bg-warning-soft text-warning", label: "Snoozed" },
  read: { className: "bg-success-soft text-success", label: "Read" },
  dropped: { className: "bg-sunken text-subtle-foreground", label: "Dropped" },
  expiring: { className: "bg-danger-soft text-danger", label: "Last chance" },
  expired: { className: "bg-sunken text-subtle-foreground", label: "Expired" },
  new: { className: "bg-info-soft text-info", label: "New" },
};

export function StatusPill({ status }: { status: string }) {
  const style = STATUS_STYLES[status] ?? {
    className: "bg-sunken text-subtle-foreground",
    label: status,
  };

  return (
    <span
      className={cx(
        "text-2xs inline-flex shrink-0 items-center rounded-full px-2 py-0.5 font-semibold",
        style.className,
      )}
    >
      {style.label}
    </span>
  );
}

// ---------------------------------------------------------------- feedback

export function Spinner({ label }: { label?: string }) {
  return (
    <span className="text-muted-foreground inline-flex items-center gap-2 text-sm" role="status">
      <span
        aria-hidden="true"
        className="border-border-strong border-t-primary size-4 animate-spin rounded-full border-2"
      />
      {label}
    </span>
  );
}

export type NoticeTone = "info" | "warning" | "error" | "success";

export function Notice({
  children,
  tone = "info",
  icon,
}: {
  children: ReactNode;
  tone?: NoticeTone;
  icon?: LucideIcon;
}) {
  const tones: Record<NoticeTone, string> = {
    info: "bg-info-soft/60 text-foreground border-info/25",
    warning: "bg-warning-soft/60 text-foreground border-warning/30",
    error: "bg-danger-soft/60 text-foreground border-danger/30",
    success: "bg-success-soft/60 text-foreground border-success/30",
  };
  const IconComponent = icon;

  return (
    <div
      role="status"
      className={cx("flex items-start gap-2.5 rounded-lg border px-3.5 py-3 text-sm", tones[tone])}
    >
      {IconComponent ? (
        <IconComponent size={16} aria-hidden="true" className="mt-0.5 shrink-0 opacity-80" />
      ) : null}
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon?: LucideIcon;
  title: string;
  body: string;
  action?: ReactNode;
}) {
  const IconComponent = icon;

  return (
    <div className="border-border flex flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-14 text-center">
      {IconComponent ? (
        <span className="bg-sunken text-subtle-foreground grid size-11 place-items-center rounded-full">
          <IconComponent size={20} aria-hidden="true" />
        </span>
      ) : null}
      <p className="font-semibold">{title}</p>
      <p className="text-muted-foreground max-w-xs text-sm">{body}</p>
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}

// ---------------------------------------------------------------- progress

export function ProgressDots({ total, done }: { total: number; done: number }) {
  // "2 of 5" rather than "2/5": three more characters, and it reads as a sentence both on
  // screen and to a screen reader (PRD 8.3 FR-S-1). The dots are the picture of the same
  // number, so they are hidden from assistive technology and the Progress carries it.
  const current = Math.min(done + 1, total);

  return (
    <Progress
      value={Math.min(done, total)}
      max={Math.max(total, 1)}
      aria-label="Session progress"
      getValueLabel={() => `${current} of ${total}`}
      className="flex w-auto min-w-0 items-center gap-2.5"
    >
      <ProgressTrack
        className="flex h-auto gap-1 overflow-visible bg-transparent"
        aria-hidden="true"
      >
        {Array.from({ length: Math.min(total, 12) }, (_, index) => (
          <span
            key={index}
            className={cx(
              "h-1 rounded-full transition-all duration-300",
              index < done ? "bg-primary w-5" : "bg-border w-2.5",
            )}
          />
        ))}
      </ProgressTrack>
      <span className="text-subtle-foreground text-xs font-semibold tabular-nums">
        {current} of {total}
      </span>
    </Progress>
  );
}

// ---------------------------------------------------------------- forms

export function Field({
  label,
  hint,
  error,
  locked,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  /** True when the environment has taken this over (PRD 16.2). */
  locked?: boolean;
  children: ReactNode;
}) {
  // UI SDK's Field ties the label, the hint and the error to whichever control is inside
  // it: the label's `for`, and `aria-describedby` on the control.
  return (
    <SdkField invalid={Boolean(error)} className="flex flex-col gap-1.5">
      <FieldLabel className="flex flex-wrap items-center gap-2 text-sm font-semibold">
        {label}
        {locked ? (
          <span className="bg-sunken text-subtle-foreground text-2xs rounded px-1.5 py-0.5 font-semibold">
            set in the environment
          </span>
        ) : null}
      </FieldLabel>
      {children}
      {hint && !error ? (
        <FieldDescription className="text-subtle-foreground text-xs">{hint}</FieldDescription>
      ) : null}
      {error ? (
        <FieldError match className="text-danger text-xs font-medium">
          {error}
        </FieldError>
      ) : null}
    </SdkField>
  );
}

export const inputClass =
  "bg-surface border-border text-foreground placeholder:text-subtle-foreground focus-visible:border-primary min-h-11 w-full rounded-lg border px-3.5 text-sm outline-none transition-colors";

export const textareaClass =
  "bg-surface border-border text-foreground placeholder:text-subtle-foreground focus-visible:border-primary w-full resize-y rounded-lg border p-3.5 text-sm outline-none transition-colors";

/** UI SDK's Input in Aeyhey's field style. Takes every native input prop. */
export function Input({
  className,
  ...props
}: Omit<ComponentProps<typeof SdkInput>, "className"> & { className?: string }) {
  return <SdkInput className={cx(inputClass, className)} {...props} />;
}

/** UI SDK's Textarea in Aeyhey's field style. */
export function Textarea({
  className,
  ...props
}: Omit<ComponentProps<typeof SdkTextarea>, "className"> & { className?: string }) {
  return <SdkTextarea className={cx(textareaClass, className)} {...props} />;
}

// ---------------------------------------------------------------- layout

/**
 * The frame every screen inside the app shell sits in. It fills the space beside the
 * sidebar instead of holding a phone-width column in the middle of a wide screen; the
 * narrower widths are for a screen that is one form and would look lost stretched out.
 */
export function Page({
  children,
  width = "full",
  className,
}: {
  children: ReactNode;
  width?: "full" | "wide" | "narrow";
  className?: string;
}) {
  const widths = { full: "max-w-[96rem]", wide: "max-w-6xl", narrow: "max-w-3xl" };
  return (
    <main
      className={cx(
        "mx-auto flex w-full flex-col gap-6 px-4 pb-28 pt-6 max-sm:gap-5 max-sm:pt-5 sm:px-6 lg:px-10 lg:pb-14 lg:pt-8",
        widths[width],
        className,
      )}
    >
      {children}
    </main>
  );
}

export function PageHeader({
  title,
  subtitle,
  action,
  back,
  eyebrow,
}: {
  title: string;
  /** One plain sentence saying what this screen is for. A first visit should not need more. */
  subtitle?: ReactNode;
  action?: ReactNode;
  back?: { href: string; label: string };
  eyebrow?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="flex min-w-0 flex-col gap-1">
        {back ? (
          <a
            href={back.href}
            className="text-subtle-foreground hover:text-foreground mb-1 inline-flex items-center gap-1 self-start text-xs font-semibold"
          >
            <ChevronLeft size={14} aria-hidden="true" />
            {back.label}
          </a>
        ) : null}
        {eyebrow ? (
          <p className="text-subtle-foreground text-2xs font-bold uppercase tracking-[0.08em]">
            {eyebrow}
          </p>
        ) : null}
        <h1 className="text-2xl font-bold lg:text-[1.875rem] lg:leading-9">{title}</h1>
        {subtitle ? (
          <p className="text-muted-foreground max-w-[70ch] text-sm lg:text-base">{subtitle}</p>
        ) : null}
      </div>
      {action ? <div className="flex shrink-0 flex-wrap items-center gap-2">{action}</div> : null}
    </header>
  );
}

/** A main column with a narrower one beside it, which stacks below on a small screen. */
export function Columns({
  children,
  aside,
  asideWidth = "md",
  asideFirstOnPhone,
}: {
  children: ReactNode;
  aside: ReactNode;
  asideWidth?: "md" | "lg";
  /**
   * On a phone the columns stack, main first. Set this when the side column is the short
   * one that has to be seen first, such as a deck's "Start a session" above its long list
   * of questions. A wide screen is unaffected.
   */
  asideFirstOnPhone?: boolean;
}) {
  return (
    <div
      className={cx(
        "grid items-start gap-6",
        asideWidth === "lg"
          ? "xl:grid-cols-[minmax(0,1fr)_minmax(22rem,0.8fr)]"
          : "xl:grid-cols-[minmax(0,1fr)_22rem]",
      )}
    >
      <div className="flex min-w-0 flex-col gap-6">{children}</div>
      <aside
        className={cx("flex min-w-0 flex-col gap-6", asideFirstOnPhone && "max-lg:order-first")}
      >
        {aside}
      </aside>
    </div>
  );
}

export function CardTitle({
  children,
  hint,
  action,
}: {
  children: ReactNode;
  hint?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="flex min-w-0 flex-col">
        <h2 className="text-sm font-bold">{children}</h2>
        {hint ? <p className="text-subtle-foreground text-xs">{hint}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

/** A link that looks like a button, for the many places a button only navigates. */
export function LinkButton({
  children,
  href,
  tone = "secondary",
  size = "md",
  icon,
  fullWidth,
  external,
  className,
}: {
  children: ReactNode;
  href: string;
  /** Opens in a new tab, for a link that leaves Aeyhey. */
  external?: boolean;
  tone?: ButtonTone;
  size?: ButtonSize;
  icon?: LucideIcon;
  fullWidth?: boolean;
  className?: string;
}) {
  const IconLeft = icon;
  const iconSize = size === "lg" ? 18 : size === "sm" ? 14 : 16;

  return (
    <LinkButtonRoot
      href={href}
      {...(external ? { external: true } : {})}
      className={cx(
        "inline-flex items-center justify-center font-semibold transition-all duration-150",
        TONES[tone],
        SIZES[size],
        fullWidth && "w-full",
        className,
      )}
    >
      {IconLeft ? <IconLeft size={iconSize} aria-hidden="true" className="shrink-0" /> : null}
      {children}
    </LinkButtonRoot>
  );
}

export function StatTile({
  icon,
  label,
  value,
  detail,
  href,
  tone = "default",
}: {
  icon?: LucideIcon;
  label: string;
  value: ReactNode;
  detail?: ReactNode;
  href?: string;
  tone?: "default" | "warning";
}) {
  const IconComponent = icon;
  const body = (
    <>
      <span className="text-muted-foreground flex items-center gap-1.5 text-xs font-semibold">
        {IconComponent ? (
          <IconComponent
            size={14}
            aria-hidden="true"
            className={tone === "warning" ? "text-warning" : "text-subtle-foreground"}
          />
        ) : null}
        {label}
      </span>
      <span className="text-[1.75rem] font-bold tabular-nums leading-none">{value}</span>
      {detail ? <span className="text-subtle-foreground text-xs">{detail}</span> : null}
    </>
  );
  const className =
    "bg-surface border-border shadow-card flex flex-col gap-2 rounded-xl border px-4 py-4 lg:px-5";

  if (!href) return <div className={className}>{body}</div>;
  return (
    <a href={href} className={cx(className, "lift")}>
      {body}
    </a>
  );
}

/**
 * A thin bar for "how much" or "how far along", on UI SDK's Meter or Progress so the
 * number reaches a screen reader as well as the eye. A meter is a measurement (questions
 * learned, a score); progress is a task under way (the getting started list).
 */
export function Bar({
  value,
  label,
  kind = "meter",
  tone = "primary",
}: {
  /** 0 to 100. */
  value: number;
  /** What is being measured, for anyone who cannot see the bar. */
  label: string;
  kind?: "meter" | "progress";
  tone?: "primary" | "success" | "warning";
}) {
  const amount = Math.round(Math.max(0, Math.min(100, value)));
  const root = "block w-full min-w-0";
  const track = "bg-sunken h-1.5 overflow-hidden rounded-full";
  const fill = cx(
    "h-full rounded-full",
    tone === "success" ? "bg-success" : tone === "warning" ? "bg-warning" : "bg-primary",
  );

  if (kind === "progress") {
    return (
      <Progress value={amount} aria-label={label} className={root}>
        <ProgressTrack className={track}>
          <ProgressIndicator className={fill} />
        </ProgressTrack>
      </Progress>
    );
  }

  return (
    <Meter value={amount} aria-label={label} className={root}>
      <MeterTrack className={track}>
        <MeterIndicator className={fill} />
      </MeterTrack>
    </Meter>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="border-border-strong text-subtle-foreground rounded border px-1.5 py-px font-sans text-[10px] font-semibold">
      {children}
    </kbd>
  );
}
