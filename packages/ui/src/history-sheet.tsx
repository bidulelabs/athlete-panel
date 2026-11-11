'use client';

import { useState, type ReactElement, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { cn } from 'cn';
import { Button } from './components/button';
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from './components/sheet';
import { useConfirmationLayer } from './provider';

export function HistorySheet({
  title,
  description,
  trigger,
  onOpen,
  notice,
  children,
  className,
}: {
  title: string;
  description: string;
  trigger: ReactElement;
  onOpen: () => void;
  notice?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const confirmation = useConfirmationLayer();
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (confirmation.isPending()) return;
        if (next) onOpen();
        setOpen(next);
      }}
    >
      <SheetTrigger asChild>{trigger}</SheetTrigger>
      <SheetContent
        className={cn('history-sheet', className)}
        showCloseButton={false}
        onEscapeKeyDown={(event) => {
          if (confirmation.isPending()) {
            // A backdrop click can leave focus on body while this Sheet owns Escape.
            event.preventDefault();
            confirmation.cancel();
          }
        }}
        onInteractOutside={(event) => {
          if (confirmation.isPending()) event.preventDefault();
        }}
      >
        <header className="history-sheet-header">
          <div>
            <SheetTitle>{title}</SheetTitle>
            <SheetDescription>{description}</SheetDescription>
          </div>
          <SheetClose asChild>
            <Button variant="ghost" size="icon" aria-label={`Close ${title.toLowerCase()}`}>
              <X size={20} aria-hidden="true" />
            </Button>
          </SheetClose>
        </header>
        {notice && <div className="history-sheet-notice">{notice}</div>}
        <div className="history-sheet-scroll">{children}</div>
      </SheetContent>
    </Sheet>
  );
}
