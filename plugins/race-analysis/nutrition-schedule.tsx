'use client';

import { Utensils } from 'lucide-react';
import { Button, EmptyState } from '@athlete-panel/ui';
import type { NutritionProduct, RaceAnalysis, RacePlan } from '@athlete-panel/contracts';
import { ToleranceBadge } from '../athlete/public/client';
import {
  carbohydrateOverMovingTimeText,
  everyMinutesText,
  nutrients,
  type hourlyIntake,
} from './nutrition';
import { movingSeconds } from './race-day';

type RaceNutrition = RacePlan['nutrition'];
type Intake = ReturnType<typeof hourlyIntake>;

const knownAmountsText = (product: NutritionProduct, servings: number) =>
  nutrients
    .filter(({ amount }) => product[amount] !== null)
    .map(({ amount, name, unit }) => `${Math.round(product[amount]! * servings)} ${unit} ${name}`)
    .join(' · ');

function ScheduleRows({
  nutrition,
  products,
}: {
  nutrition: RaceNutrition;
  products: readonly NutritionProduct[];
}) {
  return (
    <table className="race-stations race-nutrition-schedule">
      <thead>
        <tr>
          <th scope="col">When</th>
          <th scope="col">What</th>
          <th scope="col">Tolerance</th>
        </tr>
      </thead>
      <tbody>
        {nutrition.schedule.map((item, index) => {
          const product = products.find((candidate) => candidate.id === item.productId);
          const amounts = product && knownAmountsText(product, item.servings);
          return (
            <tr key={`${item.productId}-${index}`}>
              <th scope="row">{everyMinutesText(item.everyMinutes)}</th>
              <td data-label="What">
                {item.servings} × {product?.name ?? 'Removed product'}
                {amounts && <small>{amounts}</small>}
              </td>
              <td data-label="Tolerance">
                {product && <ToleranceBadge tolerance={product.tolerance} />}
              </td>
            </tr>
          );
        })}
        {nutrition.cues.map((cue, index) => (
          <tr key={`cue-${index}`}>
            <th scope="row">{cue.when}</th>
            <td data-label="What">{cue.text}</td>
            <td data-label="Tolerance" />
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function MissingValueNotices({ intake }: { intake: Intake }) {
  return (
    <>
      {intake.productsMissingNutrients.length > 0 && (
        <div className="race-data-notice" role="status">
          <strong>Not counted in the hourly totals</strong>
          <p>
            {intake.productsMissingNutrients
              .map(
                ({ product, missingNutrients }) =>
                  `${product.name} (no ${missingNutrients.map(({ name }) => name).join(' or ')} value)`,
              )
              .join(', ')}
            . Add the label values in Settings to count them.
          </p>
        </div>
      )}
      {intake.removedProductIds.length > 0 && (
        <div className="race-data-notice" role="status">
          <strong>A product of this plan was removed from Settings</strong>
          <p>It is left out of the hourly totals. Edit the plan to replace it.</p>
        </div>
      )}
    </>
  );
}

export function DuringRaceCard({
  nutrition,
  products,
  intake,
  estimate,
  course,
  stations,
  busy,
  onEdit,
}: Pick<RaceAnalysis, 'estimate' | 'course'> & {
  nutrition: RaceNutrition;
  products: readonly NutritionProduct[];
  intake: Intake;
  stations: RacePlan['stations'];
  busy: boolean;
  onEdit: () => void;
}) {
  const planned = nutrition.schedule.length + nutrition.cues.length > 0;
  const carbohydrateTotal =
    nutrition.schedule.length > 0 &&
    carbohydrateOverMovingTimeText(
      intake.perHour.carbohydrateGrams,
      movingSeconds(estimate, course?.analysis.sections ?? [], stations),
    );
  return (
    <section className="race-estimate" aria-labelledby="race-schedule-title">
      <div className="race-section-heading">
        <div>
          <h2 id="race-schedule-title">During the race</h2>
          <p className="race-hint">
            Products come from your profile. Timing is a reminder, adjust around technical ground.
          </p>
        </div>
        <Button variant="outline" disabled={busy} onClick={onEdit}>
          Edit plan
        </Button>
      </div>
      {!planned && products.length === 0 ? (
        <EmptyState icon={<Utensils size={25} />} title="Add the products you use">
          Gels, drinks and food live in Settings so every race can reuse them. Targets work without
          them. <a href="/settings">Open Settings</a>, then Nutrition.
        </EmptyState>
      ) : !planned ? (
        <p className="race-hint">Nothing planned during the race yet.</p>
      ) : (
        <>
          <ScheduleRows nutrition={nutrition} products={products} />
          <MissingValueNotices intake={intake} />
          {carbohydrateTotal && (
            <p className="race-hint race-nutrition-total">{carbohydrateTotal}</p>
          )}
        </>
      )}
    </section>
  );
}
