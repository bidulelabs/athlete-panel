'use client';

import { useId, useRef, useState, type RefObject, type ReactNode } from 'react';
import {
  X,
  AlertCircle,
  LoaderCircle,
  Plus,
  Activity,
  Bike,
  Footprints,
  Dumbbell,
  Waves,
} from 'lucide-react';
import { Button } from './components/button';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from './components/dialog';
import { Field as ShadcnField, FieldLabel, FieldDescription } from './components/field';
import { Alert, AlertDescription } from './components/alert';
import { startOfWeek } from './calendar-dates';
export { addDays, localDate } from './calendar-dates';

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        {description && <p className="page-description">{description}</p>}
      </div>
      {actions && <div className="header-actions">{actions}</div>}
    </header>
  );
}

export function EmptyState({
  icon,
  title,
  children,
  action,
}: {
  icon?: ReactNode;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <div className="empty-icon">{icon ?? <Activity size={25} />}</div>
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  wide = false,
  className = '',
  closeLabel = 'Close dialog',
  closeOnBackdrop = true,
  focusHeading = false,
  initialFocusRef,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  wide?: boolean;
  className?: string;
  closeLabel?: string;
  closeOnBackdrop?: boolean;
  focusHeading?: boolean;
  initialFocusRef?: RefObject<HTMLElement | null>;
}) {
  const trigger = useRef<HTMLElement | null>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const descriptionId = useId();
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!value) onClose();
      }}
    >
      <DialogContent
        showCloseButton={false}
        className={`ui-modal dialog ${wide ? 'ui-modal-wide dialog-wide' : ''} ${className}`}
        aria-describedby={description ? descriptionId : undefined}
        onEscapeKeyDown={(event) => event.preventDefault()}
        onKeyDown={(event) => {
          // Dismiss the dialog containing keyboard focus. Document-level listeners
          // can still belong to the previous layer during nested portal transitions.
          if (
            event.key === 'Escape' &&
            event.target instanceof Element &&
            event.target.closest('[role="dialog"], [role="alertdialog"]') === event.currentTarget
          ) {
            event.preventDefault();
            event.stopPropagation();
            if (!document.querySelector('[role="alertdialog"][data-state="open"]')) onClose();
          }
        }}
        onOpenAutoFocus={(event) => {
          trigger.current =
            document.activeElement instanceof HTMLElement ? document.activeElement : null;
          if (focusHeading || initialFocusRef?.current) {
            event.preventDefault();
            (initialFocusRef?.current ?? titleRef.current)?.focus();
          } else {
            const input = (event.target as HTMLElement).querySelector<HTMLElement>(
              'input:not([type="hidden"]):not([disabled]), textarea:not([disabled]), select:not([disabled])',
            );
            if (input) {
              event.preventDefault();
              input.focus();
            }
          }
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (trigger.current?.isConnected) trigger.current.focus({ preventScroll: true });
        }}
        onInteractOutside={(event) => {
          if (!closeOnBackdrop) event.preventDefault();
        }}
      >
        <div className="dialog-head">
          <div>
            <DialogTitle ref={titleRef} tabIndex={focusHeading ? -1 : undefined}>
              {title}
            </DialogTitle>
            {description && <DialogDescription id={descriptionId}>{description}</DialogDescription>}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={closeLabel}
            onClick={onClose}
          >
            <X size={19} />
          </Button>
        </div>
        {children}
      </DialogContent>
    </Dialog>
  );
}

export function Field({
  label,
  children,
  hint,
  className = '',
}: {
  label: string;
  children: ReactNode;
  hint?: string;
  className?: string;
}) {
  return (
    <ShadcnField className={`field ${className}`}>
      <FieldLabel asChild>
        <label>
          <span>{label}</span>
          {children}
        </label>
      </FieldLabel>
      {hint && <FieldDescription>{hint}</FieldDescription>}
    </ShadcnField>
  );
}

export function ErrorMessage({ error }: { error: string | null | undefined }) {
  return error ? (
    <Alert variant="destructive" className="error-message">
      <AlertCircle size={17} />
      <AlertDescription>{error}</AlertDescription>
    </Alert>
  ) : null;
}

export function SubmitButton({
  busy,
  children = 'Save changes',
  className = '',
}: {
  busy: boolean;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <Button type="submit" className={className} disabled={busy}>
      {busy && <LoaderCircle className="spin" size={16} />}
      {busy ? 'Saving…' : children}
    </Button>
  );
}

export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run(action: () => Promise<unknown>, done?: () => void) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await action();
      done?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, setError, run };
}

export function SportIcon({ sport, size = 19 }: { sport?: string | null; size?: number }) {
  const key = (sport ?? '').toLowerCase();
  const Icon =
    key.includes('cycl') || key.includes('bike')
      ? Bike
      : key.includes('run')
        ? Footprints
        : key.includes('swim')
          ? Waves
          : key.includes('strength')
            ? Dumbbell
            : Activity;
  return <Icon size={size} strokeWidth={1.6} />;
}

export function monday(date: string) {
  return startOfWeek(date, 1);
}
export function dateLabel(
  date: string,
  options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' },
) {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString('en-GB', { ...options, timeZone: 'UTC' });
}
export function duration(seconds: number | null | undefined) {
  if (seconds == null || !Number.isFinite(seconds)) return '—';
  const minutes = Math.round(seconds / 60);
  return minutes >= 60
    ? `${Math.floor(minutes / 60)}h${minutes % 60 ? ` ${minutes % 60}m` : ''}`
    : `${minutes}m`;
}
export function distance(meters: number | null | undefined, units = 'metric') {
  if (meters == null || !Number.isFinite(meters)) return '—';
  return `${(meters / (units === 'imperial' ? 1609.344 : 1000)).toFixed(1)} ${units === 'imperial' ? 'mi' : 'km'}`;
}
export function sportLabel(sport: string | null | undefined) {
  return (sport ?? 'Other')
    .toLowerCase()
    .replaceAll('_', ' ')
    .replace(/^./, (s) => s.toUpperCase());
}
export const requestId = () => crypto.randomUUID();
export const numeric = (value: FormDataEntryValue | null) =>
  value === null || value === '' ? null : Number(value);

export function AddButton({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <Button type="button" onClick={onClick}>
      <Plus size={17} />
      {children}
    </Button>
  );
}

export function Stat({
  label,
  value,
  suffix,
  hint,
}: {
  label: string;
  value: ReactNode;
  suffix?: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <div className="stat">
      <span>{label}</span>
      <strong>
        {value}
        {suffix && <small>{suffix}</small>}
      </strong>
      {hint && <span className="stat-hint">{hint}</span>}
    </div>
  );
}

export function MiniBars({
  values,
  labels,
  empty = 'No recorded data for this period',
  formatter = (n: number) => String(n),
}: {
  values: (number | null)[];
  labels: string[];
  empty?: string;
  formatter?: (n: number) => string;
}) {
  const max = Math.max(1, ...values.filter((v): v is number => v != null));
  if (values.every((v) => v == null)) return <div className="chart-empty">{empty}</div>;
  return (
    <div
      className="mini-chart"
      role="img"
      aria-label={values
        .map((v, i) => `${labels[i]}: ${v == null ? 'unknown' : formatter(v)}`)
        .join(', ')}
    >
      {values.map((value, i) => (
        <div className="mini-column" key={i}>
          <span className="bar-value">{value == null ? '—' : formatter(value)}</span>
          <div className="bar-track">
            <div
              className={`bar-fill ${value == null ? 'missing' : ''}`}
              style={{
                height:
                  value == null ? '0' : `${Math.max(value > 0 ? 2 : 0, (value / max) * 100)}%`,
              }}
            />
          </div>
          <span className="bar-label">{labels[i]}</span>
        </div>
      ))}
    </div>
  );
}
