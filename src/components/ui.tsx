import { useEffect, useRef, useState } from "react";
import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  TextareaHTMLAttributes,
} from "react";

const cx = (...parts: Array<string | false | null | undefined>): string =>
  parts.filter(Boolean).join(" ");

/* ---------------- Button ---------------- */

type ButtonVariant = "primary" | "secondary" | "danger" | "compact" | "compact-quiet";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  block?: boolean;
}

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: "mr-btn--primary",
  secondary: "mr-btn--secondary",
  /** 되돌릴 수 없는 동작 전용. 채우지 않고 글자에만 빨강을 둔다 (DESIGN.md §4) */
  danger: "mr-btn--danger",
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

interface TextAreaFieldProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string;
  hint?: string | undefined;
  hintTone?: "muted" | "warn";
}

/**
 * 여러 줄 입력. Field 와 label · hint 를 **같은 구조로** 쓴다 — 입력만 있고 설명이
 * 없는 필드를 만들지 않는다는 규칙(DESIGN.md §4)은 한 줄이든 여러 줄이든 같다.
 *
 * 높이만 다르다: 한 줄 입력의 48px 고정 높이 대신 최소 높이를 주고 세로로만 늘린다
 * (가로로 늘어나면 읽기 폭 720px 제한이 깨진다).
 */
export function TextAreaField({ label, hint, hintTone = "muted", id, ...rest }: TextAreaFieldProps) {
  const auto = useRef("mr-t-" + Math.random().toString(36).slice(2, 8));
  const fieldId = id ?? auto.current;
  return (
    <label className="mr-field" htmlFor={fieldId}>
      <span className="mr-field__label">{label}</span>
      <textarea id={fieldId} className="mr-input mr-textarea" {...rest} />
      {hint ? (
        <span className={cx("mr-field__hint", hintTone === "warn" && "mr-field__hint--warn")}>
          {hint}
        </span>
      ) : null}
    </label>
  );
}

/* ---------------- RadioGroup ---------------- */

export interface RadioOption<T extends string> {
  value: T;
  label: string;
}

/**
 * 네이티브 라디오 위에 커스텀 도트를 얹는다 — 브라우저 기본 동그라미 대신
 * Apple 지오메트리(pill)와 액션 색을 쓴다. input 은 시각적으로 숨기되
 * DOM 에 남겨 스크린리더·키보드 포커스·클릭 위임(label 이 감싼다)이 그대로 동작한다.
 */
export function RadioGroup<T extends string>({
  name,
  legend,
  options,
  value,
  onChange,
}: {
  name: string;
  legend: string;
  options: readonly RadioOption<T>[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <fieldset className="mr-radiogroup">
      <legend className="mr-field__label">{legend}</legend>
      <div className="mr-radiogroup__options">
        {options.map((opt) => (
          <label key={opt.value} className="mr-radio">
            <input
              type="radio"
              name={name}
              className="mr-radio__input"
              checked={value === opt.value}
              onChange={() => onChange(opt.value)}
            />
            <span className="mr-radio__dot" aria-hidden="true" />
            <span className="mr-radio__label">{opt.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
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
  /*
   * `glass` prop 은 없앴다. 유리를 걷어낸 뒤(DESIGN.md §6) `--glass` modifier 는
   * `.mr-card` 와 완전히 같은 선언이 됐고, 이름만 남은 별칭을 유지하면 다음 사람이
   * "여긴 유리를 쓰는 자리" 로 오해한다.
   */
  return (
    <div className={cx("mr-card", mine && "mr-card--mine", className)} style={style}>
      {children}
    </div>
  );
}

/* ---------------- Badge ---------------- */

export function Badge({
  tone,
  children,
}: {
  /** 배지는 "여기만 봐라" 는 신호다 — 색 없는 중립 배지는 두지 않는다(DESIGN.md §4). */
  tone: "mine" | "attn";
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

// omd:feel MODAL 🟢 — Tab 트랩 대상 요소. 표시되지 않거나(offsetParent null)
// 비활성인 요소는 순환에서 제외한다.
const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

function getFocusable(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (el) => el.offsetParent !== null || el === document.activeElement,
  );
}

/**
 * omd:feel MODAL 🟢 — 배경 inert.
 * 이 앱은 Dialog 를 portal 없이 트리 안에 그대로 렌더한다. 그래서 "형제만 inert" 가
 * 아니라 backdrop 노드부터 document.body 까지 올라가며 각 층의 형제 요소를 전부
 * inert 처리한다 — 어느 화면에서 열리든 다이얼로그 자신의 조상 경로만 남고 나머지는
 * 조작 불가능해진다. inert 미지원 브라우저는 aria-hidden 으로 대체한다.
 */
function useBackgroundInert(backdropEl: HTMLElement | null) {
  useEffect(() => {
    if (!backdropEl) return;
    const restore: Array<() => void> = [];
    let node: Element | null = backdropEl;
    while (node && node !== document.body) {
      const parent: Element | null = node.parentElement;
      if (parent) {
        for (const sibling of Array.from(parent.children)) {
          if (sibling === node) continue;
          if ("inert" in sibling) {
            const el = sibling as HTMLElement & { inert: boolean };
            if (el.inert) continue;
            el.inert = true;
            restore.push(() => {
              el.inert = false;
            });
          } else {
            const hadAriaHidden = sibling.hasAttribute("aria-hidden");
            const prevValue = sibling.getAttribute("aria-hidden");
            sibling.setAttribute("aria-hidden", "true");
            restore.push(() => {
              if (hadAriaHidden && prevValue !== null) {
                sibling.setAttribute("aria-hidden", prevValue);
              } else {
                sibling.removeAttribute("aria-hidden");
              }
            });
          }
        }
      }
      node = parent;
    }
    return () => {
      for (const undo of restore) undo();
    };
  }, [backdropEl]);
}

/**
 * omd:feel SCROLL/LAYOUT STABILITY 🟢 — 배경 스크롤 잠금.
 * overflow:hidden 만 걸면 스크롤바가 사라지며 본문 폭이 넓어져 레이아웃이 튄다.
 * 사라진 스크롤바 폭만큼 paddingRight 로 보정한다.
 */
function useBodyScrollLock() {
  useEffect(() => {
    const { body } = document;
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
    const prevOverflow = body.style.overflow;
    const prevPaddingRight = body.style.paddingRight;
    body.style.overflow = "hidden";
    if (scrollbarWidth > 0) {
      const current = parseFloat(window.getComputedStyle(body).paddingRight) || 0;
      body.style.paddingRight = `${current + scrollbarWidth}px`;
    }
    return () => {
      body.style.overflow = prevOverflow;
      body.style.paddingRight = prevPaddingRight;
    };
  }, []);
}

export function Dialog({
  title,
  subtitle,
  onClose,
  children,
  actions,
  actionsLayout = "end",
  dismissible = true,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  actions: ReactNode;
  /** "split" 은 파괴적 동작을 안전한 기본 동작에서 떨어뜨린다 */
  actionsLayout?: "end" | "split";
  /**
   * omd:feel MODAL 🟢 — backdrop 클릭으로 닫히는지.
   * 정보성 다이얼로그는 true(기본값), 데이터 입력·파괴적 확인은 호출부에서 false 로.
   * (호출부 전환은 이 컴포넌트 담당 범위 밖 — concerns 참조)
   */
  dismissible?: boolean;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [backdropEl, setBackdropEl] = useState<HTMLDivElement | null>(null);
  // 열리기 직전 포커스였던 요소 — 렌더 시점(첫 effect 가 돌기 전)에 캡처해야
  // 아래 focus-in effect 가 포커스를 옮기기 전 값을 잃지 않는다.
  const triggerRef = useRef<HTMLElement | null>(
    document.activeElement instanceof HTMLElement ? document.activeElement : null,
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusable = getFocusable(panel);
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) {
        e.preventDefault();
        return;
      }
      const activeEl = document.activeElement;
      if (e.shiftKey) {
        if (activeEl === first || !panel.contains(activeEl)) {
          e.preventDefault();
          last.focus();
        }
      } else if (activeEl === last || !panel.contains(activeEl)) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // 최초 진입 포커스는 마운트 시 한 번만. deps 에 onClose 를 넣으면(호출부가
  // 인라인 함수를 넘길 때 매 렌더 재실행돼) 사용자가 다이얼로그 안에서 입력 중에도
  // 포커스가 패널로 다시 튕겨 나가는 버그가 생긴다.
  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  useBackgroundInert(backdropEl);
  useBodyScrollLock();

  // 언마운트(= 닫힘) 시 트리거로 포커스 복원. deps 없이 한 번만 등록해
  // 리렌더마다 재실행되지 않게 한다 — 캡처한 트리거는 다이얼로그 생애주기 동안 불변.
  useEffect(() => {
    const trigger = triggerRef.current;
    return () => {
      trigger?.focus();
    };
  }, []);

  return (
    <div
      className="mr-backdrop"
      ref={setBackdropEl}
      onMouseDown={(e) => {
        if (dismissible && e.target === e.currentTarget) onClose();
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
        <div className={cx("mr-dialog__actions", actionsLayout === "split" && "mr-dialog__actions--split")}>
          {actions}
        </div>
      </div>
    </div>
  );
}

/* ---------------- Alert ---------------- */

export function Alert({ tone = "warn", children }: { tone?: "warn" | "info"; children: ReactNode }) {
  /*
   * warn 은 사용자의 행동을 막은 결과(예약 실패·로그인 실패)라 즉시 읽혀야 하므로
   * role="alert"(assertive). info 는 맥락 안내일 뿐이라 polite 로 둔다 —
   * 안내까지 assertive 로 하면 스크린리더가 읽던 문장을 계속 끊는다.
   */
  return (
    <div
      className={cx("mr-alert", tone === "info" && "mr-alert--info")}
      role={tone === "warn" ? "alert" : "status"}
    >
      {children}
    </div>
  );
}
