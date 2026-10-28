'use client';

import { Button } from '@athlete-panel/ui';

export default function WorkspaceError() {
  return (
    <main className="login-layout">
      <section className="login-form-panel">
        <div className="login-form" role="alert">
          <div className="eyebrow">YOUR PRIVATE WORKSPACE</div>
          <h1>Athlete Panel is unavailable</h1>
          <p>The server could not load this page. Try again in a moment.</p>
          <Button className="button primary full-width" onClick={() => window.location.reload()}>
            Try again
          </Button>
        </div>
      </section>
    </main>
  );
}
