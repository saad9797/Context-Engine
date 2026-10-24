import React, { useSyncExternalStore } from 'react';
import { getBackendStatus, subscribeBackendStatus, warmBackend } from '../api/warmup';

export default function BackendStatus() {
  const status = useSyncExternalStore(subscribeBackendStatus, getBackendStatus);
  if (status !== 'starting' && status !== 'unavailable') return null;
  return (
    <aside className="backend-status" role="status" aria-live="polite" aria-atomic="true">
      <span className="backend-status-dot" aria-hidden="true" />
      <div>
        <strong>{status === 'starting' ? 'Connecting to Contexa' : 'Unable to reach Contexa'}</strong>
        <p>{status === 'starting'
          ? 'The server may be starting after inactivity. This usually takes about a minute. You can keep browsing while we check automatically.'
          : 'The server is taking longer than expected or your connection is unavailable. Check your connection and try again.'}</p>
      </div>
      {status === 'unavailable' && <button type="button" onClick={warmBackend}>Try again</button>}
    </aside>
  );
}
