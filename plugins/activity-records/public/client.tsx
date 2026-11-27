'use client';

import { Button, ErrorMessage, useAction, useWorkspace } from '@athlete-panel/ui';
import { Download } from 'lucide-react';

export function DownloadActivityRoute({ id }: { id: string }) {
  const { request } = useWorkspace();
  const action = useAction();
  return (
    <div className="mt-3">
      <Button
        variant="outline"
        disabled={action.busy}
        onClick={() =>
          action.run(async () => {
            const { filename, gpx } = await request('activity-records', 'download-gpx', { id });
            const url = URL.createObjectURL(new Blob([gpx], { type: 'application/gpx+xml' }));
            const link = document.createElement('a');
            link.href = url;
            link.download = filename;
            link.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
          })
        }
      >
        <Download size={15} />
        Download GPX
      </Button>
      <ErrorMessage error={action.error} />
    </div>
  );
}
