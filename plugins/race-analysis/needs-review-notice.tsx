'use client';

import type { ReactNode } from 'react';
import { TriangleAlert } from 'lucide-react';
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  ErrorMessage,
  useAction,
  type PluginPageProps,
} from '@athlete-panel/ui';
import type { RacePlan } from '@athlete-panel/contracts';
import { mutate } from '../training/public/client';
import { strategyNeedsReview } from './race-plan-form';

export function NeedsReviewNotice({
  racePlan,
  courseId,
  request,
  hasUnsavedChanges = false,
  children,
}: Pick<PluginPageProps, 'request'> & {
  racePlan: RacePlan | undefined;
  courseId: string | null;
  hasUnsavedChanges?: boolean;
  children: ReactNode;
}) {
  const action = useAction();
  if (!racePlan || !strategyNeedsReview(racePlan, courseId)) return null;
  return (
    <Alert role="status" className="race-review-notice">
      <TriangleAlert />
      <AlertTitle>This plan needs review</AlertTitle>
      <AlertDescription>
        <p>{children}</p>
        {hasUnsavedChanges ? (
          <p>Save your changes before marking the plan as reviewed.</p>
        ) : (
          <Button
            variant="outline"
            disabled={action.busy}
            onClick={() =>
              void action.run(() =>
                mutate(request, [
                  {
                    action: 'racePlan.update',
                    id: racePlan.id,
                    expectedRevision: racePlan.revision,
                    values: { courseId },
                  },
                ]),
              )
            }
          >
            Mark as reviewed
          </Button>
        )}
        <ErrorMessage error={action.error} />
      </AlertDescription>
    </Alert>
  );
}
