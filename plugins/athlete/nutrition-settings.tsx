'use client';

import type { NutritionProduct, NutritionProfile } from '@athlete-panel/contracts';
import {
  AddButton,
  Alert,
  Badge,
  Button,
  EmptyState,
  ErrorMessage,
  Field,
  Input,
  Modal,
  NativeSelect,
  numeric,
  requestId,
  SubmitButton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
  useAction,
  useConfirm,
  type PluginPageProps,
} from '@athlete-panel/ui';
import { Check, Edit3, Trash2, UtensilsCrossed } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { mutate } from '../training/public/client';
import './nutrition.css';

const emptyNutrition: NutritionProfile = {
  products: [],
  carryCapacityMillilitres: null,
  preferences: '',
};
const kindLabels = { gel: 'Gel', drink: 'Drink', food: 'Food', other: 'Other' };
const sourceLabels = { label: 'label', estimate: 'your estimate' };
const toleranceLabels = {
  comfortable: 'Comfortable',
  mild: 'Mild discomfort',
  poor: 'Poor',
  untested: 'Not tested',
};
const amountFields = [
  ['carbohydrateGrams', 'Carbs', 'g'],
  ['fluidMillilitres', 'Fluid', 'ml'],
  ['sodiumMilligrams', 'Sodium', 'mg'],
  ['caffeineMilligrams', 'Caffeine', 'mg'],
] as const;

const amountText = (value: number | null, unit: string) =>
  value === null ? 'unknown' : `${value} ${unit}`;

function ProductDialog({
  product,
  busy,
  error,
  onSave,
  onClose,
}: {
  product?: NutritionProduct;
  busy: boolean;
  error: ReturnType<typeof useAction>['error'];
  onSave: (product: NutritionProduct) => void;
  onClose: () => void;
}) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    onSave({
      id: product?.id ?? requestId(),
      name: String(form.get('name')),
      kind: String(form.get('kind')) as NutritionProduct['kind'],
      carbohydrateGrams: numeric(form.get('carbohydrateGrams')),
      fluidMillilitres: numeric(form.get('fluidMillilitres')),
      sodiumMilligrams: numeric(form.get('sodiumMilligrams')),
      caffeineMilligrams: numeric(form.get('caffeineMilligrams')),
      source: String(form.get('source')) as NutritionProduct['source'],
      tolerance: String(form.get('tolerance')) as NutritionProduct['tolerance'],
    });
  }
  return (
    <Modal
      open
      onClose={onClose}
      title={product ? 'Edit product' : 'Add product'}
      description="Values per serving. Leave a value blank when you do not know it."
    >
      <form className="dialog-body" onSubmit={submit}>
        <Field label="Name">
          <Input
            autoFocus
            required
            name="name"
            maxLength={255}
            defaultValue={product?.name ?? ''}
            placeholder="e.g. Citrus gel"
          />
        </Field>
        <div className="form-grid">
          <Field label="Type">
            <NativeSelect name="kind" defaultValue={product?.kind ?? 'gel'}>
              {Object.entries(kindLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Values from">
            <NativeSelect name="source" defaultValue={product?.source ?? 'label'}>
              <option value="label">The label</option>
              <option value="estimate">Your estimate</option>
            </NativeSelect>
          </Field>
        </div>
        <div className="form-grid">
          {amountFields.map(([name, label, unit]) => (
            <Field key={name} label={`${label} · ${unit}`}>
              <Input
                type="number"
                min="0"
                step="any"
                name={name}
                placeholder="Unknown"
                defaultValue={product?.[name] ?? ''}
              />
            </Field>
          ))}
        </div>
        <Field label="Your tolerance">
          <NativeSelect name="tolerance" defaultValue={product?.tolerance ?? 'untested'}>
            {Object.entries(toleranceLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <ErrorMessage error={error} />
        <div className="dialog-actions">
          <Button variant="outline" type="button" className="button" onClick={onClose}>
            Cancel
          </Button>
          <SubmitButton busy={busy}>{product ? 'Save changes' : 'Add product'}</SubmitButton>
        </div>
      </form>
    </Modal>
  );
}

function ProductTable({
  products,
  busy,
  onEdit,
  onRemove,
}: {
  products: NutritionProduct[];
  busy: boolean;
  onEdit: (product: NutritionProduct) => void;
  onRemove: (product: NutritionProduct) => void;
}) {
  return (
    <div className="nutrition-products-scroll">
      <Table className="nutrition-products">
        <TableHeader>
          <TableRow>
            <TableHead>Product</TableHead>
            {amountFields.map(([name, label]) => (
              <TableHead key={name} className="numeric">
                {label}
              </TableHead>
            ))}
            <TableHead>Your tolerance</TableHead>
            <TableHead>
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {products.map((product) => (
            <TableRow key={product.id}>
              <TableCell>
                <strong>{product.name}</strong>
                <div className="muted-text">
                  {kindLabels[product.kind]} · {sourceLabels[product.source]}
                </div>
              </TableCell>
              {amountFields.map(([name, , unit]) => (
                <TableCell key={name} className="numeric">
                  {amountText(product[name], unit)}
                </TableCell>
              ))}
              <TableCell>
                <Badge className={product.tolerance === 'comfortable' ? 'badge success' : 'badge'}>
                  {toleranceLabels[product.tolerance]}
                </Badge>
              </TableCell>
              <TableCell>
                <div className="table-actions">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="icon-button"
                    aria-label={`Edit ${product.name}`}
                    onClick={() => onEdit(product)}
                  >
                    <Edit3 size={15} />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="icon-button"
                    aria-label={`Remove ${product.name}`}
                    disabled={busy}
                    onClick={() => onRemove(product)}
                  >
                    <Trash2 size={15} />
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

const saveNutrition = (
  request: PluginPageProps['request'],
  nutrition: NutritionProfile,
  expectedRevision: number | null,
) => mutate(request, [{ action: 'profile.set', expectedRevision, values: { nutrition } }]);

function CarryCapacityAndPreferencesForm({
  nutrition,
  revision,
  request,
}: {
  nutrition: NutritionProfile;
  revision: number | null;
  request: PluginPageProps['request'];
}) {
  const action = useAction();
  const [loadedNutrition, setLoadedNutrition] = useState(nutrition);
  const [formKey, setFormKey] = useState(0);
  const [saved, setSaved] = useState(false);
  const changedElsewhere =
    loadedNutrition.carryCapacityMillilitres !== nutrition.carryCapacityMillilitres ||
    loadedNutrition.preferences !== nutrition.preferences;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaved(false);
    const form = new FormData(event.currentTarget);
    const next = {
      ...nutrition,
      carryCapacityMillilitres: numeric(form.get('carryCapacityMillilitres')),
      preferences: String(form.get('preferences')),
    };
    await action.run(async () => {
      await saveNutrition(request, next, revision);
      setLoadedNutrition(next);
      setSaved(true);
    });
  }
  return (
    <form key={formKey} onSubmit={submit}>
      {changedElsewhere && (
        <Alert className="callout" role="status">
          <p>
            Your nutrition changed elsewhere. Your draft is preserved. Copy anything you want to
            keep before loading the saved version.
          </p>
          <Button
            variant="outline"
            type="button"
            className="button"
            disabled={action.busy}
            onClick={() => {
              setLoadedNutrition(nutrition);
              setFormKey((key) => key + 1);
              setSaved(false);
              action.setError(null);
            }}
          >
            Load saved nutrition
          </Button>
        </Alert>
      )}
      <section className="profile-form-section">
        <h2>What you can carry</h2>
        <p>Used to check each leg between stations.</p>
        <Field label="Carry capacity · ml" hint="Bottles and flasks together.">
          <Input
            type="number"
            min="0"
            max="20000"
            step="1"
            name="carryCapacityMillilitres"
            placeholder="Unknown"
            defaultValue={loadedNutrition.carryCapacityMillilitres ?? ''}
          />
        </Field>
      </section>
      <section className="profile-form-section">
        <h2>Diet and preferences</h2>
        <p>Plain text. Shared with an assistant only when you allow it for a race.</p>
        <Field label="Diet and preferences">
          <Textarea
            name="preferences"
            rows={4}
            maxLength={2000}
            defaultValue={loadedNutrition.preferences}
            placeholder="e.g. Vegetarian. No lactose in the 3 hours before running."
          />
        </Field>
      </section>
      <ErrorMessage error={action.error} />
      {saved && (
        <div className="success-message" role="status">
          <Check size={15} />
          Nutrition saved.
        </div>
      )}
      <SubmitButton busy={action.busy}>Save nutrition</SubmitButton>
    </form>
  );
}

export function NutritionSettings({ data, request }: PluginPageProps) {
  const confirm = useConfirm();
  const action = useAction();
  const [editing, setEditing] = useState<{ product?: NutritionProduct } | null>(null);
  const nutrition = data.profile?.nutrition ?? emptyNutrition;
  const revision = data.profile?.revision ?? null;
  const saveProducts = (products: NutritionProduct[], done?: () => void) =>
    void action.run(() => saveNutrition(request, { ...nutrition, products }, revision), done);
  return (
    <div className="nutrition-settings">
      <section className="profile-form-section">
        <div className="nutrition-heading">
          <div>
            <h2>Products you use</h2>
            <p>Reused by every race. Values per serving, from the label or your own estimate.</p>
          </div>
          <AddButton onClick={() => setEditing({})}>Add product</AddButton>
        </div>
        {!editing && <ErrorMessage error={action.error} />}
        {nutrition.products.length ? (
          <ProductTable
            products={nutrition.products}
            busy={action.busy}
            onEdit={(product) => setEditing({ product })}
            onRemove={async (product) => {
              if (await confirm(`Remove ${product.name}?`, 'Remove'))
                saveProducts(nutrition.products.filter((other) => other.id !== product.id));
            }}
          />
        ) : (
          <EmptyState icon={<UtensilsCrossed size={25} />} title="No products yet">
            Add the gels, drinks and food you train and race with.
          </EmptyState>
        )}
      </section>
      <CarryCapacityAndPreferencesForm
        nutrition={nutrition}
        revision={revision}
        request={request}
      />
      {editing && (
        <ProductDialog
          product={editing.product}
          busy={action.busy}
          error={action.error}
          onClose={() => {
            action.setError(null);
            setEditing(null);
          }}
          onSave={(product) =>
            saveProducts(
              editing.product
                ? nutrition.products.map((other) => (other.id === product.id ? product : other))
                : [...nutrition.products, product],
              () => setEditing(null),
            )
          }
        />
      )}
    </div>
  );
}
