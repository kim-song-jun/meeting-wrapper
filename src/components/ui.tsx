import { useEffect, useRef } from "react";
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";

const cx = (...parts: Array<string | false | null | undefined>): string =>
  parts.filter(Boolean).join(" ");

/* ---------------- Button ---------------- */

type ButtonVariant = "primary" | "secondary" | "compact" | "compact-quiet";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  block?: boolean;
}

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: "mr-btn--primary",
  secondary: "mr-btn--secondary",
  compact: "mr-btn--compact",
  "compact-quiet": "mr-btn--compact mr-btn--quiet",
};

export function Button({ variant = "primary", block, className, ...rest }: ButtonProps) {
  return (
    <button
      type="button"
      className={cx("mr-btn", VARIANT_CLASS[variant], block && "mr-btn--block", className)}
      {...rest}
    />
  );
}

/**
 * 비활성 버튼과 그 사유를 함께 놓는다.
 * DESIGN.md §4: 사유를 툴팁이 아니라 상시 노출한다.
 */
export function ButtonWithReason({
  reason,
  ...buttonProps
}: ButtonProps & { reason?: string | null }) {
  return (
    <span className="mr-row" style={{ gap: 8 }}>
      <Button {...buttonProps} />
      {reason ? <span className="mr-reason">{reason}</span> : null}
    </span>
  );
}

/* ---------------- Input ---------------- */

interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: string | undefined;
  hintTone?: "muted" | "warn";
}

export function Field({ label, hint, hintTone = "muted", id, ...rest }: FieldProps) {
  const auto = useRef("mr-f-" + Math.random().toString(36).slice(2, 8));
  const fieldId = id ?? auto.current;
  return (
    <label className="mr-field" htmlFor={fieldId}>
      <span className="mr-field__label">{label}</span>
      <input id={fieldId} className="mr-input" {...rest} />
      {hint ? (
        <span className={cx("mr-field__hint", hintTone === "warn" && "mr-field__hint--warn")}>
          {hint}
        </span>
      ) : null}
    </label>
  );
}

/* ---------------- Card ---------------- */

export function Card({
  children,
  mine,
  className,
  style,
}: {
  children: ReactNode;
  mine?: boolean;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div className={cx("mr-card", mine && "mr-card--mine", className)} style={style}>
      {children}
    </div>
  );
}

/* ---------------- Badge ---------------- */

export function Badge({
  tone = "neutral",
  children,
}: {
  tone?: "mine" | "attn" | "neutral";
  children: ReactNode;
}) {
  return <span className={cx("mr-badge", "mr-badge--" + tone)}>{children}</span>;
}

/* ---------------- Tabs ---------------- */

export interface TabItem {
  id: string;
  label: string;
}

export function Tabs({
  items,
  active,
  onChange,
}: {
  items: readonly TabItem[];
  active: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="mr-tabs" role="tablist">
      {items.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          className="mr-tab"
          aria-selected={t.id === active}
          onClick={() => onChange(t.id)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

/* ---------------- Dialog ---------------- */

export function Dialog({
  title,
  subtitle,
  onClose,
  children,
  actions,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  actions: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    panelRef.current?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="mr-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="mr-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        ref={panelRef}
      >
        <h2 className="mr-dialog__title">{title}</h2>
        {subtitle ? <p className="mr-dialog__sub t-num">{subtitle}</p> : null}
        {children}
        <div className="mr-dialog__actions">{actions}</div>
      </div>
    </div>
  );
}

/* ---------------- Alert ---------------- */

export function Alert({ tone = "warn", children }: { tone?: "warn" | "info"; children: ReactNode }) {
  return (
    <div className={cx("mr-alert", tone === "info" && "mr-alert--info")} role="status">
      {children}
    </div>
  );
}
