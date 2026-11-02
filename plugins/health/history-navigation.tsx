'use client';

import { useId, useRef, useState } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import {
  Button,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
  ToggleGroup,
  ToggleGroupItem,
  dateLabel,
} from '@athlete-panel/ui';
import {
  earliestHistoryEnd,
  historyPeriods,
  moveHistoryEnd,
  validHistoryEnd,
  type HistoryPeriod,
} from './history-range';

export function HistoryNavigation({
  from,
  to,
  today,
  days,
  onDaysChange,
  onEndChange,
}: {
  from: string;
  to: string;
  today: string;
  days: HistoryPeriod;
  onDaysChange: (days: HistoryPeriod) => void;
  onEndChange: (date: string) => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [draftEnd, setDraftEnd] = useState(to);
  const rangeButton = useRef<HTMLButtonElement>(null);
  const dateId = useId();
  const rangeLabel = `${dateLabel(from, {
    day: 'numeric',
    month: 'short',
    ...(from.slice(0, 4) !== to.slice(0, 4) ? { year: 'numeric' } : {}),
  })} – ${dateLabel(to, { day: 'numeric', month: 'short', year: 'numeric' })}`;

  return (
    <section className="health-history-navigation" aria-label="Health history dates">
      <div className="health-history-controls">
        <div className="health-history-presets">
          <ToggleGroup
            type="single"
            variant="outline"
            value={String(days)}
            aria-label="History period"
            onValueChange={(value) => {
              const period = historyPeriods.find((candidate) => String(candidate) === value);
              if (period) onDaysChange(period);
            }}
          >
            {historyPeriods.map((period) => (
              <ToggleGroupItem key={period} value={String(period)}>
                {period} days
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          {to !== today && (
            <Button
              variant="ghost"
              onClick={() => {
                onEndChange(today);
                rangeButton.current?.focus();
              }}
            >
              Today
            </Button>
          )}
        </div>
        <div className="health-history-step">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Previous period"
            disabled={to === earliestHistoryEnd}
            onClick={() => onEndChange(moveHistoryEnd(to, days, -1, today))}
          >
            <ChevronLeft size={17} />
          </Button>
          <Popover
            open={pickerOpen}
            onOpenChange={(open) => {
              if (open) setDraftEnd(to);
              setPickerOpen(open);
            }}
          >
            <PopoverTrigger asChild>
              <Button
                ref={rangeButton}
                variant="ghost"
                className="health-history-range"
                aria-label={`Choose history dates, ${rangeLabel}`}
              >
                <span>{rangeLabel}</span>
                <ChevronDown size={14} />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="health-history-picker" aria-label="History date picker">
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!validHistoryEnd(draftEnd, today)) return;
                  onEndChange(draftEnd);
                  setPickerOpen(false);
                }}
              >
                <label htmlFor={dateId}>Jump to date</label>
                <p id={`${dateId}-hint`}>Show {days} days through this date.</p>
                <Input
                  id={dateId}
                  type="date"
                  aria-describedby={`${dateId}-hint`}
                  value={draftEnd}
                  min={earliestHistoryEnd}
                  max={today}
                  required
                  onChange={(event) => setDraftEnd(event.target.value)}
                />
                <Button type="submit" disabled={!validHistoryEnd(draftEnd, today)}>
                  Show period
                </Button>
              </form>
            </PopoverContent>
          </Popover>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Next period"
            disabled={to === today}
            onClick={() => onEndChange(moveHistoryEnd(to, days, 1, today))}
          >
            <ChevronRight size={17} />
          </Button>
        </div>
      </div>
    </section>
  );
}
