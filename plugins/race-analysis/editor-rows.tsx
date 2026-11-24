'use client';

import { useRef, useState, type ReactNode } from 'react';
import { Button, Field, NativeSelect } from '@athlete-panel/ui';
import type { NutritionProduct } from '@athlete-panel/contracts';

export type EditorRow<T> = { key: string; item: T | undefined; justAdded: boolean };

export function useEditorRows<T>(items: readonly T[]) {
  const [rows, setRows] = useState<EditorRow<T>[]>(() =>
    items.map((item) => ({ key: crypto.randomUUID(), item, justAdded: false })),
  );
  const addButton = useRef<HTMLButtonElement>(null);
  return {
    rows,
    addButton,
    add: () => setRows([...rows, { key: crypto.randomUUID(), item: undefined, justAdded: true }]),
    remove: (key: string) => {
      setRows(rows.filter((row) => row.key !== key));
      requestAnimationFrame(() => addButton.current?.focus());
    },
  };
}

export function RemovableRow({
  legend,
  className,
  readOnly,
  onRemove,
  children,
}: {
  legend: string;
  className: string;
  readOnly: boolean;
  onRemove: () => void;
  children: ReactNode;
}) {
  return (
    <fieldset className={`race-nutrition-row ${className}`}>
      <legend>{legend}</legend>
      {children}
      <Button
        type="button"
        variant="ghost"
        aria-label={`Remove ${legend.toLowerCase()}`}
        disabled={readOnly}
        onClick={onRemove}
      >
        Remove
      </Button>
    </fieldset>
  );
}

export function ProductField({
  name,
  productId,
  products,
  readOnly,
  autoFocus,
}: {
  name: string;
  productId: string | undefined;
  products: readonly NutritionProduct[];
  readOnly: boolean;
  autoFocus: boolean;
}) {
  const removedProductId =
    productId && !products.some((product) => product.id === productId) ? productId : null;
  return (
    <Field label="Product">
      <NativeSelect
        name={name}
        defaultValue={productId ?? products[0]?.id}
        disabled={readOnly}
        autoFocus={autoFocus}
      >
        {removedProductId && <option value={removedProductId}>Removed from Settings</option>}
        {products.map((product) => (
          <option key={product.id} value={product.id}>
            {product.name}
          </option>
        ))}
      </NativeSelect>
    </Field>
  );
}
