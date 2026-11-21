'use client';

import type { NutritionProduct, RacePlan } from '@athlete-panel/contracts';
import type { carryPlan } from './carry';

type CarryPlan = NonNullable<ReturnType<typeof carryPlan>>;
type CarryLeg = CarryPlan['legs'][number];
type Station = RacePlan['stations'][number];

const litres = (millilitres: number) => `${Number((millilitres / 1000).toFixed(2))} L`;

export function carriedText(leg: CarryLeg) {
  const carried = [
    ...(leg.waterMillilitres === null ? [] : [`${litres(leg.waterMillilitres)} water`]),
    ...leg.products.map(({ product, servings }) => `${servings} × ${product.name}`),
  ];
  return carried.length ? carried.join(', ') : null;
}

function CapacityNotice({
  carry,
  placeName,
}: {
  carry: CarryPlan;
  placeName: (meters: number) => string;
}) {
  const overLegs = carry.legs.filter((leg) => leg.waterOverCapacity);
  if (overLegs.length === 0) return null;
  return (
    <div className="race-data-notice race-carry-warning" role="status">
      <strong>
        {overLegs.length === 1
          ? 'One leg is over your carrying capacity'
          : `${overLegs.length} legs are over your carrying capacity`}
      </strong>
      {overLegs.map((leg) => (
        <p key={leg.fromMeters}>
          {placeName(leg.fromMeters)} → {placeName(leg.waterNextRefillMeters!)} needs about{' '}
          {litres(leg.waterNeededMillilitres!)} at {Math.round(carry.fluidPerHour!)} ml per hour.
          You carry up to {litres(carry.carryCapacityMillilitres!)}.
        </p>
      ))}
    </div>
  );
}

function DropBag({
  leg,
  station,
  products,
  placeName,
}: {
  leg: CarryLeg;
  station: Station;
  products: readonly NutritionProduct[];
  placeName: (meters: number) => string;
}) {
  const contents = station.dropBag.map((item) => {
    const product = products.find((candidate) => candidate.id === item.productId);
    return `${item.servings} × ${product?.name ?? 'Removed from Settings'}`;
  });
  return (
    <div>
      <h3>{station.name} drop bag</h3>
      <p>{contents.join(', ')}</p>
      {leg.missingProducts.map((missing) => (
        <p key={missing.product.id} className="race-late">
          {missing.servings} × {missing.product.name} short until{' '}
          {placeName(missing.nextRestockMeters)}
        </p>
      ))}
    </div>
  );
}

export function WhatToCarry({
  carry,
  scheduled,
  products,
  placeName,
}: {
  carry: CarryPlan;
  scheduled: boolean;
  products: readonly NutritionProduct[];
  placeName: (meters: number) => string;
}) {
  const unknowns = [
    !scheduled && 'Add a food plan on Nutrition to see what to carry.',
    carry.fluidPerHour === null &&
      'Water need unknown: no fluid target and no fluid value in the food plan.',
    carry.fluidPerHour !== null &&
      carry.carryCapacityMillilitres === null &&
      'Carry capacity unknown: water is not checked against it.',
  ].filter((fact): fact is string => !!fact);
  const bagLegs = carry.legs.filter((leg) => !!leg.station && leg.station.dropBag.length > 0);
  return (
    <section className="race-carry" aria-labelledby="race-carry-title">
      <div className="race-section-heading">
        <div>
          <h2 id="race-carry-title">What to carry</h2>
          <p className="race-hint">
            Each leg above says what to leave with, from your nutrition targets, leg times and the
            products in your profile.
          </p>
        </div>
      </div>
      <CapacityNotice carry={carry} placeName={placeName} />
      {unknowns.length > 0 && (
        <ul className="race-carry-facts">
          {unknowns.map((fact) => (
            <li key={fact}>{fact}</li>
          ))}
        </ul>
      )}
      {bagLegs.length > 0 && (
        <div className="race-carry-grid">
          {bagLegs.map((leg) => (
            <DropBag
              key={leg.station!.id}
              leg={leg}
              station={leg.station!}
              products={products}
              placeName={placeName}
            />
          ))}
        </div>
      )}
      <details className="race-disclosure">
        <summary>
          <span>How this is worked out</span>
          <small>Rounding, refills and what is not counted</small>
        </summary>
        <ul className="race-disclosure-body">
          <li>
            Each product is taken every planned interval of moving time, the first one after the
            first interval. Half servings add up across legs and the total is rounded up.
          </li>
          <li>
            Products come back only from your drop bags. Bottles are filled at the start and at
            stations that list water with what the legs to the next water need, up to your carry
            capacity.
          </li>
          <li>
            Food offered at a station replaces the first planned food serving of the next leg. It is
            never counted as extra.
          </li>
          <li>
            Water uses your fluid target, or the fluid in your food plan when there is no target.
          </li>
          <li>Unconfirmed stations are still counted.</li>
        </ul>
      </details>
    </section>
  );
}
