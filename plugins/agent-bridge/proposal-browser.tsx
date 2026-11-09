'use client';
import { useId, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { Button, Field, Input, NativeSelect } from '@athlete-panel/ui';
import type { ProposalDetails } from '@athlete-panel/contracts';
import { ProposedEdits } from './proposal-changes';
import { matchesChange, typeCounts, typeLabels } from './proposal-presentation';

export function ProposalBrowser({
  changes,
  planTitles,
}: {
  changes: ProposalDetails['changes'];
  planTitles: Record<string, string>;
}) {
  const [query, setQuery] = useState('');
  const [type, setType] = useState('');
  const [action, setAction] = useState('');
  const [expanded, setExpanded] = useState(false);
  const filterId = useId();
  const filtered = Boolean(query.trim() || type || action);
  const visible = useMemo(
    () => changes.filter((change) => matchesChange(change, query, type, action)),
    [changes, query, type, action],
  );
  return (
    <>
      <div className="proposal-edits-heading">
        <h3>Proposed edits</h3>
        <Button
          variant="ghost"
          aria-expanded={expanded}
          aria-controls={filterId}
          onClick={() => setExpanded((value) => !value)}
        >
          <Search size={16} aria-hidden="true" />
          Find changes
        </Button>
      </div>
      <div id={filterId} className="proposal-filter-fields" hidden={!expanded}>
        <Field label="Search changes">
          <Input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Title, sport or date"
          />
        </Field>
        <Field label="Item type">
          <NativeSelect value={type} onChange={(event) => setType(event.target.value)}>
            <option value="">All types</option>
            {typeCounts(changes).map((item) => (
              <option key={item.type} value={item.type}>
                {typeLabels[item.type] ?? item.type} ({item.count})
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="Action">
          <NativeSelect value={action} onChange={(event) => setAction(event.target.value)}>
            <option value="">All actions</option>
            <option value="create">Create</option>
            <option value="update">Update</option>
            <option value="delete">Delete</option>
          </NativeSelect>
        </Field>
      </div>
      {filtered && (
        <div className="proposal-filter-result">
          <p role="status">
            Showing {visible.length} of {changes.length} changes. Apply includes all{' '}
            {changes.length} changes.
          </p>
          <Button
            variant="ghost"
            onClick={() => {
              setQuery('');
              setType('');
              setAction('');
            }}
          >
            Clear filters
          </Button>
        </div>
      )}
      {visible.length ? (
        <ProposedEdits changes={visible} planTitles={planTitles} />
      ) : (
        <p className="proposal-no-results">
          No changes match these filters. Try another title, type or action.
        </p>
      )}
    </>
  );
}
