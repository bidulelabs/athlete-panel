'use client';

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { TooltipProvider } from './components/tooltip';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from './components/alert-dialog';

type Confirm = (message: string, action?: string) => Promise<boolean>;
const ConfirmContext = createContext<Confirm | null>(null);
export function useConfirm(): Confirm {
  const confirm = useContext(ConfirmContext);
  if (!confirm) throw new Error('Confirmation requires UiProvider.');
  return confirm;
}
export function UiProvider({ children }: { children: ReactNode }) {
  const [prompt, setPrompt] = useState<{ message: string; action: string } | null>(null);
  const pending = useRef<((value: boolean) => void) | null>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const confirm = useCallback<Confirm>((message, action = 'Confirm') => {
    pending.current?.(false);
    trigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setPrompt({ message, action });
    return new Promise((resolve) => {
      pending.current = resolve;
    });
  }, []);
  const settle = (value: boolean) => {
    pending.current?.(value);
    pending.current = null;
    setPrompt(null);
  };
  return (
    <TooltipProvider delayDuration={300}>
      <ConfirmContext.Provider value={confirm}>
        {children}
        <AlertDialog
          open={prompt !== null}
          onOpenChange={(open) => {
            if (!open) settle(false);
          }}
        >
          <AlertDialogContent
            className="ui-confirm"
            onKeyDownCapture={(event) => {
              // This owner-level confirmation can sit above a Sheet in another React subtree.
              // Handle its focused Escape even during the underlying layer's effect handoff.
              if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                settle(false);
              }
            }}
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              if (trigger.current?.isConnected) trigger.current.focus({ preventScroll: true });
            }}
          >
            <AlertDialogTitle>Confirm change</AlertDialogTitle>
            <AlertDialogDescription>{prompt?.message}</AlertDialogDescription>
            <div className="ui-confirm-actions">
              <AlertDialogCancel onClick={() => settle(false)}>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={() => settle(true)}>
                {prompt?.action ?? 'Confirm'}
              </AlertDialogAction>
            </div>
          </AlertDialogContent>
        </AlertDialog>
      </ConfirmContext.Provider>
    </TooltipProvider>
  );
}
