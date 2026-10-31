'use client';

import { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { addCalendarYears } from '@athlete-panel/contracts';
import { addDays, Checkbox, ErrorMessage, Field, Input, NativeSelect } from '@athlete-panel/ui';

const categories = {
  activities: 'Recorded activities',
  health: 'Health measurements',
  training: 'Plans, workouts and completion',
  context: 'Current profile, goals, events and injuries',
};
type Category = keyof typeof categories;

function DateRange({
  kind,
  today,
  error,
  range,
  onRange,
}: {
  kind: 'history' | 'planning';
  today: string;
  error?: string;
  range: { from: string; to: string };
  onRange: (range: { from: string; to: string }) => void;
}) {
  const history = kind === 'history';
  const [preset, setPreset] = useState(() =>
    history
      ? range.from === addCalendarYears(today, -5) && range.to === today
        ? '5'
        : 'custom'
      : range.from === addDays(today, -28) && range.to === addDays(today, 14)
        ? 'short'
        : 'custom',
  );
  const { from, to } = range;
  const choose = (value: string) => {
    setPreset(value);
    if (value === 'custom') return;
    onRange({
      from: history
        ? addCalendarYears(today, -Number(value))
        : value === 'short'
          ? addDays(today, -28)
          : today,
      to: history
        ? today
        : value === 'year'
          ? addCalendarYears(today, 1)
          : addDays(today, value === 'short' ? 14 : 83),
    });
  };
  return (
    <>
      <Field label={history ? 'History period' : 'Proposal period'}>
        <NativeSelect value={preset} onChange={(event) => choose(event.target.value)}>
          {history ? (
            <>
              <option value="1">Last year</option>
              <option value="3">Last three years</option>
              <option value="5">Last five years</option>
            </>
          ) : (
            <>
              <option value="short">Recent + next 2 weeks</option>
              <option value="12weeks">Next 12 weeks</option>
              <option value="year">Next year</option>
            </>
          )}
          <option value="custom">Custom dates</option>
        </NativeSelect>
      </Field>
      <div className="form-grid">
        <Field label={history ? 'History from' : 'Read and propose from'}>
          <Input
            required
            type="date"
            name={history ? 'historyFrom' : 'from'}
            value={from}
            onChange={(event) => {
              onRange({ from: event.target.value, to });
              setPreset('custom');
            }}
          />
        </Field>
        <Field label={history ? 'History through' : 'Through'}>
          <Input
            required
            type="date"
            name={history ? 'historyTo' : 'to'}
            value={to}
            onChange={(event) => {
              onRange({ from, to: event.target.value });
              setPreset('custom');
            }}
          />
        </Field>
      </div>
      <ErrorMessage error={error ?? null} />
      <p className="form-footnote">
        Both dates are included. Up to {history ? 'five calendar years' : 'one calendar year'};
        future dates are allowed.
      </p>
    </>
  );
}

/** The visible receipt is derived from the same form values sent for approval. */
export function ConnectionAccess({
  today,
  weekStartsOn,
  errors,
}: {
  today: string;
  weekStartsOn: 0 | 1;
  errors: Record<string, string>;
}) {
  const [history, setHistory] = useState(false);
  const [planning, setPlanning] = useState(true);
  const [historyRange, setHistoryRange] = useState({
    from: addCalendarYears(today, -5),
    to: today,
  });
  const [planningRange, setPlanningRange] = useState({
    from: addDays(today, -28),
    to: addDays(today, 14),
  });
  const [historyNotes, setHistoryNotes] = useState(false);
  const [planningNotes, setPlanningNotes] = useState(false);
  const [expiry, setExpiry] = useState('1');
  const [selected, setSelected] = useState<Category[]>(Object.keys(categories) as Category[]);
  const range = (value: { from: string; to: string }) =>
    `${value.from || 'Choose a start date'} through ${value.to || 'choose an end date'}`;
  return (
    <div className="connection-access">
      <fieldset className="connection-capability">
        <legend>
          <label className="checkbox-row">
            <Checkbox
              name="allowHistory"
              checked={history}
              onCheckedChange={(value) => setHistory(value === true)}
            />
            Read my history
          </label>
        </legend>
        <p className="muted-text">Let your assistant understand long-term patterns.</p>
        {history && (
          <div className="connection-scope">
            <DateRange
              kind="history"
              today={today}
              error={errors.history}
              range={historyRange}
              onRange={setHistoryRange}
            />
            <details className="connection-customize">
              <summary>
                <ChevronRight size={16} aria-hidden="true" />
                Customize shared data
              </summary>
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
                Include private notes in historical review
              </label>
            </details>
          </div>
        )}
      </fieldset>
      <fieldset className="connection-capability">
        <legend>
          <label className="checkbox-row">
            <Checkbox
              name="allowPlanning"
              checked={planning}
              onCheckedChange={(value) => setPlanning(value === true)}
            />
            Suggest training changes
          </label>
        </legend>
        <p className="muted-text">Nothing changes until you review and apply the proposal.</p>
        {planning && (
          <div className="connection-scope">
            <DateRange
              kind="planning"
              today={today}
              error={errors.planning}
              range={planningRange}
              onRange={setPlanningRange}
            />
            <details className="connection-customize">
              <summary>
                <ChevronRight size={16} aria-hidden="true" />
                Customize shared data
              </summary>
              <p>
                Planning shares profile, goals, availability, zones, training, events, injuries,
                activities and health within these dates.
              </p>
              <label className="checkbox-row">
                <Checkbox
                  name="includeNotes"
                  checked={planningNotes}
                  onCheckedChange={(value) => setPlanningNotes(value === true)}
                />
                Include private plan, workout, interval, completion, and calendar notes
              </label>
            </details>
          </div>
        )}
      </fieldset>
      <ErrorMessage error={errors.capabilities ?? null} />
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
        <h2>Your assistant’s access</h2>
        <dl>
          <div>
            <dt>History</dt>
            <dd>
              {history ? (
                <>
                  {range(historyRange)}
                  <br />
                  {selected.length
                    ? selected.map((category) => categories[category]).join(' · ')
                    : 'Select at least one data category.'}
                  <br />
                  Private notes: {historyNotes ? 'included' : 'excluded'} · Weeks start{' '}
                  {weekStartsOn === 0 ? 'Sunday' : 'Monday'}
                </>
              ) : (
                'Not shared'
              )}
            </dd>
          </div>
          <div>
            <dt>Proposals</dt>
            <dd>
              {planning ? (
                <>
                  {range(planningRange)}
                  <br />
                  Profile, goals, availability, zones, training, events, injuries, activities and
                  health.
                  <br />
                  Private notes: {planningNotes ? 'included' : 'excluded'}
                </>
              ) : (
                'Not permitted'
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
            ? 'You must review and explicitly apply every proposal in Athlete Panel.'
            : history
              ? 'This connection is read-only. Proposal submission is not permitted.'
              : 'Choose at least one permission to connect.'}
        </p>
      </section>
      <p className="form-footnote">
        Your external agent may send shared data to its model provider. Secrets, raw provider
        payloads and GPS are always excluded.
      </p>
    </div>
  );
}
