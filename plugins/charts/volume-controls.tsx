'use client';

import {
  chartsSports,
  sportTypeLabel,
  type ChartsGrouping,
  type ChartsSport,
} from '@athlete-panel/contracts';
import { ChevronDown } from 'lucide-react';
import {
  Button,
  Checkbox,
  Field,
  NativeSelect,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@athlete-panel/ui';

export function VolumeControls({
  sports,
  grouping,
  onSportsChange,
  onGroupingChange,
}: {
  sports: ChartsSport[];
  grouping: ChartsGrouping;
  onSportsChange: (sports: ChartsSport[]) => void;
  onGroupingChange: (grouping: ChartsGrouping) => void;
}) {
  const all = sports.length === chartsSports.length;
  const label = all ? 'All sports' : sports.map(sportTypeLabel).join(', ');
  return (
    <>
      <div className="field charts-sports-field">
        <span className="charts-filter-label">Sports</span>
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              className="charts-sports-trigger"
              aria-label={`Sports: ${label}`}
            >
              <span>{label}</span>
              <ChevronDown size={16} aria-hidden="true" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="charts-sports-picker" aria-label="Choose sports" align="start">
            <p>Choose one or more sports.</p>
            <Button
              variant="outline"
              onClick={() => onSportsChange([...chartsSports])}
              disabled={all}
            >
              All sports
            </Button>
            {chartsSports.map((sport) => (
              <div className="charts-sport-option" key={sport}>
                <label>
                  <Checkbox
                    checked={sports.includes(sport)}
                    disabled={sports.length === 1 && sports[0] === sport}
                    onCheckedChange={(checked) =>
                      onSportsChange(
                        chartsSports.filter((candidate) =>
                          candidate === sport ? checked === true : sports.includes(candidate),
                        ),
                      )
                    }
                  />
                  <span>{sportTypeLabel(sport)}</span>
                </label>
                <Button
                  variant="ghost"
                  aria-label={`Only ${sportTypeLabel(sport)}`}
                  onClick={() => onSportsChange([sport])}
                >
                  Only
                </Button>
              </div>
            ))}
          </PopoverContent>
        </Popover>
      </div>
      <Field label="Group by">
        <NativeSelect
          value={grouping}
          onChange={(event) => onGroupingChange(event.target.value as ChartsGrouping)}
        >
          <option value="day">Day</option>
          <option value="week">Week</option>
          <option value="month">Month</option>
        </NativeSelect>
      </Field>
    </>
  );
}
