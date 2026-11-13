'use client';

import { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { addCalendarYears } from '@athlete-panel/contracts';
import { addDays, Checkbox, ErrorMessage, Field, Input, NativeSelect } from '@athlete-panel/ui';
import { historyAnniversaryStart } from './connection-periods';

const categories = {
  activities: 'Recorded activities',
  health: 'Health measurements',
  training: 'Plans, workouts and completion',
  context: 'Current profile, goals, events and injuries',
};
type Category = keyof typeof categories;
type Range = { from: string; to: string };

function DateRange({
  kind,
  custom,
  range,
  onRange,
}: {
  kind: 'history' | 'planning';
  custom: boolean;
  range: Range;
  onRange: (range: Range) => void;
}) {
  const history = kind === 'history';
  const names = history ? ['historyFrom', 'historyTo'] : ['from', 'to'];
  if (!custom)
    return (
      <>
        <input type="hidden" name={names[0]} value={range.from} />
        <input type="hidden" name={names[1]} value={range.to} />
      </>
    );
  return (
    <>
      <div className="form-grid">
        <Field label={history ? 'History from' : 'Proposals from'}>
          <Input
            required
            type="date"
            name={names[0]}
            value={range.from}
            onChange={(event) => onRange({ ...range, from: event.target.value })}
          />
        </Field>
        <Field label={history ? 'History through' : 'Proposals through'}>
          <Input
            required
            type="date"
            name={names[1]}
            value={range.to}
            onChange={(event) => onRange({ ...range, to: event.target.value })}
          />
        </Field>
      </div>
      <p className="form-footnote">
        Both dates are included. Up to {history ? 'five calendar years' : 'one calendar year'};
        future dates are allowed.
      </p>
    </>
  );
}

/** The receipt and submitted scopes use the same values; presets never couple the ranges. */
export function ConnectionAccess({
  today,
  weekStartsOn,
  errors,
}: {
  today: string;
  weekStartsOn: 0 | 1;
  errors: Record<string, string>;
}) {
  const [historyPreset, setHistoryPreset] = useState('4weeks');
  const [planningPreset, setPlanningPreset] = useState('short');
  const [planning, setPlanning] = useState(true);
  const [allowEventCreation, setAllowEventCreation] = useState(true);
  const [allowPhaseChanges, setAllowPhaseChanges] = useState(true);
  const [historyRange, setHistoryRange] = useState<Range>({ from: addDays(today, -27), to: today });
  const [planningRange, setPlanningRange] = useState<Range>({
    from: today,
    to: addDays(today, 13),
  });
  const [historyNotes, setHistoryNotes] = useState(false);
  const [planningNotes, setPlanningNotes] = useState(false);
  const [expiry, setExpiry] = useState('1');
  const [selected, setSelected] = useState<Category[]>(Object.keys(categories) as Category[]);
  const history = historyPreset !== 'none';
  const range = (value: Range) =>
    `${value.from || 'Choose a start date'} through ${value.to || 'choose an end date'}`;
  return (
    <div className="connection-access">
      <div className="connection-scope">
        <Field label="How much history can your assistant read?">
          <NativeSelect
            value={historyPreset}
            onChange={(event) => {
              const value = event.target.value;
              setHistoryPreset(value);
              if (value !== 'none' && value !== 'custom')
                setHistoryRange({
                  from:
                    value === '4weeks'
                      ? addDays(today, -27)
                      : historyAnniversaryStart(today, value === '1' ? 1 : 5),
                  to: today,
                });
            }}
          >
            <option value="4weeks">Last 4 weeks</option>
            <option value="1">Last year</option>
            <option value="5">Last 5 years</option>
            <option value="custom">Custom dates</option>
            <option value="none">None</option>
          </NativeSelect>
        </Field>
        {history && (
          <>
            <input type="hidden" name="allowHistory" value="on" />
            <DateRange
              kind="history"
              custom={historyPreset === 'custom'}
              range={historyRange}
              onRange={setHistoryRange}
            />
          </>
        )}
        <ErrorMessage error={errors.history ?? null} />
      </div>
      <div className="connection-scope">
        <Field label="Can it suggest training changes?">
          <NativeSelect
            value={planning ? 'yes' : 'no'}
            onChange={(event) => setPlanning(event.target.value === 'yes')}
          >
            <option value="yes">Yes, for me to review</option>
            <option value="no">No, analysis only</option>
          </NativeSelect>
        </Field>
        {planning && (
          <>
            <input type="hidden" name="allowPlanning" value="on" />
            <Field label="Proposal period">
              <NativeSelect
                value={planningPreset}
                onChange={(event) => {
                  const value = event.target.value;
                  setPlanningPreset(value);
                  if (value !== 'custom')
                    setPlanningRange({
                      from: today,
                      to:
                        value === 'year'
                          ? addCalendarYears(today, 1)
                          : addDays(today, value === 'short' ? 13 : 83),
                    });
                }}
              >
                <option value="short">Next 2 weeks</option>
                <option value="12weeks">Next 12 weeks</option>
                <option value="year">Next year</option>
                <option value="custom">Custom dates</option>
              </NativeSelect>
            </Field>
            <DateRange
              kind="planning"
              custom={planningPreset === 'custom'}
              range={planningRange}
              onRange={setPlanningRange}
            />
            <p className="form-footnote">
              Your assistant can also read existing training and context in this period.
            </p>
            <ErrorMessage error={errors.planning ?? null} />
            <label className="checkbox-row">
              <Checkbox
                name="allowEventCreation"
                checked={allowEventCreation}
                onCheckedChange={(value) => setAllowEventCreation(value === true)}
              />
              Allow proposals to create races and goals
            </label>
            <label className="checkbox-row">
              <Checkbox
                name="allowPhaseChanges"
                checked={allowPhaseChanges}
                onCheckedChange={(value) => setAllowPhaseChanges(value === true)}
              />
              Allow proposals to change plan phases
            </label>
          </>
        )}
      </div>
      <ErrorMessage error={errors.capabilities ?? null} />
      {(history || planning) && (
        <details className="connection-customize">
          <summary>
            <ChevronRight size={16} aria-hidden="true" />
            Customize shared data
          </summary>
          {history && (
            <fieldset>
              <legend>History data</legend>
              {(Object.keys(categories) as Category[]).map((category) => (
                <label className="checkbox-row" key={category}>
                  <Checkbox
                    name="categories"
                    value={category}
                    checked={selected.includes(category)}
                    onCheckedChange={(value) =>
                      setSelected((items) =>
                        value === true
                          ? [...items, category]
                          : items.filter((item) => item !== category),
                      )
                    }
                  />
                  {categories[category]}
                </label>
              ))}
              <label className="checkbox-row">
                <Checkbox
                  name="historyNotes"
                  checked={historyNotes}
                  onCheckedChange={(value) => setHistoryNotes(value === true)}
                />
                Include private notes in history
              </label>
            </fieldset>
          )}
          {planning && (
            <fieldset>
              <legend>Proposal context</legend>
              <p>
                Profile, goals, availability, zones, training, events, injuries, activities and
                health in the proposal period.
              </p>
              <label className="checkbox-row">
                <Checkbox
                  name="includeNotes"
                  checked={planningNotes}
                  onCheckedChange={(value) => setPlanningNotes(value === true)}
                />
                Include private notes in the proposal period
              </label>
            </fieldset>
          )}
        </details>
      )}
      <Field label="Access expires after">
        <NativeSelect
          name="expiresInHours"
          value={expiry}
          onChange={(event) => setExpiry(event.target.value)}
        >
          <option value="1">1 hour</option>
          <option value="4">4 hours</option>
          <option value="24">24 hours</option>
        </NativeSelect>
      </Field>
      <section className="connection-receipt" aria-label="Access summary" aria-live="polite">
        <h2>Before you approve</h2>
        <dl>
          <div>
            <dt>Read history</dt>
            <dd>
              {history ? (
                <>
                  {range(historyRange)}
                  <br />
                  {selected.length
                    ? selected.map((category) => categories[category]).join(' · ')
                    : 'Select at least one history category.'}
                  <br />
                  Private notes: {historyNotes ? 'included' : 'excluded'} · Weeks start{' '}
                  {weekStartsOn === 0 ? 'Sunday' : 'Monday'}
                </>
              ) : planning ? (
                'Only the proposal period, shown below.'
              ) : (
                'No history selected.'
              )}
            </dd>
          </div>
          <div>
            <dt>Propose changes</dt>
            <dd>
              {planning ? (
                <>
                  {range(planningRange)}
                  <br />
                  Create races and goals: {allowEventCreation ? 'permitted' : 'not permitted'}
                  <br />
                  Change plan phases: {allowPhaseChanges ? 'permitted' : 'not permitted'}
                  <br />
                  Can also read profile, goals, availability, zones, training, events, injuries,
                  activities and health in this period.
                  <br />
                  Private notes: {planningNotes ? 'included' : 'excluded'}
                </>
              ) : (
                'Not permitted. Analysis only.'
              )}
            </dd>
          </div>
          <div>
            <dt>Expires</dt>
            <dd>
              {expiry} hour{expiry !== '1' ? 's' : ''} after approval. Disconnect anytime.
            </dd>
          </div>
        </dl>
        <p>
          {planning
            ? 'Only you can apply changes, after reviewing the exact proposal in Agent workspace.'
            : history
              ? 'This connection is read-only. It cannot submit proposals or change your training.'
              : 'Choose a history period or allow training proposals to connect.'}
        </p>
      </section>
      <p className="form-footnote">
        Your external agent may send shared data to its model provider. Secrets, raw provider
        payloads and GPS are always excluded.
      </p>
    </div>
  );
}
