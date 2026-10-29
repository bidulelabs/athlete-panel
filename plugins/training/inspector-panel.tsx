'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Sheet, SheetContent, SheetTitle } from '@athlete-panel/ui';
import './inspector.css';

export function InspectorPanel({
  children,
  onClose,
  deferResize = false,
  alwaysOverlay = false,
}: {
  children: ReactNode;
  onClose: () => void;
  deferResize?: boolean;
  alwaysOverlay?: boolean;
}) {
  const [overlay, setOverlay] = useState(
    () =>
      alwaysOverlay ||
      (typeof window !== 'undefined' && window.matchMedia('(max-width: 1050px)').matches),
  );
  const trigger = useRef<HTMLElement | null>(
    typeof document !== 'undefined' && document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null,
  );
  const panel = useRef<HTMLDivElement>(null);
  const focusedAction = useRef<string | null>(null);
  const focusAction = () => {
    const buttons = Array.from(panel.current?.querySelectorAll<HTMLButtonElement>('button') ?? []);
    (
      buttons.find(
        (button) =>
          (button.getAttribute('aria-label') || button.textContent) === focusedAction.current,
      ) ?? buttons[0]
    )?.focus({ preventScroll: true });
  };
  useEffect(() => {
    return () => {
      if (trigger.current?.isConnected) trigger.current.focus({ preventScroll: true });
    };
  }, []);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 1050px)');
    const sync = () => {
      if (!deferResize) setOverlay(alwaysOverlay || media.matches);
    };
    sync();
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, [deferResize, alwaysOverlay]);
  useEffect(() => {
    if (!overlay && !deferResize) focusAction();
  }, [overlay]);
  const confirming = () =>
    Boolean(document.querySelector('[role="alertdialog"][data-state="open"]'));
  const content = (
    <aside
      onFocusCapture={(event) => {
        if (
          event.target instanceof HTMLButtonElement &&
          event.target.closest('.inspector') === event.currentTarget
        )
          focusedAction.current =
            event.target.getAttribute('aria-label') || event.target.textContent;
      }}
      className="inspector"
      aria-label="Workout details"
    >
      {children}
    </aside>
  );
  if (overlay)
    return (
      <Sheet
        open
        onOpenChange={(open) => {
          if (!open && !deferResize && !confirming()) onClose();
        }}
      >
        <SheetContent
          ref={panel}
          className="inspector-frame"
          data-overlay="true"
          showCloseButton={false}
          aria-describedby={undefined}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            focusAction();
          }}
          onCloseAutoFocus={(event) => event.preventDefault()}
          onEscapeKeyDown={(event) => {
            if (deferResize || confirming()) event.preventDefault();
          }}
          onInteractOutside={(event) => {
            if (deferResize || confirming()) event.preventDefault();
          }}
        >
          <SheetTitle className="sr-only">Workout details</SheetTitle>
          {content}
        </SheetContent>
      </Sheet>
    );
  return (
    <div
      ref={panel}
      className="inspector-frame"
      data-overlay="false"
      onKeyDown={(event) => {
        if (
          event.key === 'Escape' &&
          !deferResize &&
          !document.querySelector('[role="alertdialog"][data-state="open"]')
        ) {
          event.preventDefault();
          onClose();
        }
      }}
    >
      {content}
    </div>
  );
}
