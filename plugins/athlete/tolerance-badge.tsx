'use client';

import { Badge } from '@athlete-panel/ui';
import type { NutritionProduct } from '@athlete-panel/contracts';
import './tolerance-badge.css';

export const toleranceLabels: Record<NutritionProduct['tolerance'], string> = {
  comfortable: 'Comfortable',
  mild: 'Mild discomfort',
  poor: 'Poor',
  untested: 'Not tested',
};
const toleranceBadges = {
  comfortable: 'badge success',
  mild: 'badge tolerance-mild',
  poor: 'badge tolerance-poor',
  untested: 'badge',
};

export function ToleranceBadge({ tolerance }: { tolerance: NutritionProduct['tolerance'] }) {
  return <Badge className={toleranceBadges[tolerance]}>{toleranceLabels[tolerance]}</Badge>;
}
