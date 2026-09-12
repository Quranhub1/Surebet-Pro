// Load the CommonJS compatibility patch before index.ts creates the analysis service.
// Keep the football provider on the authenticated API-Football path; BSD remains
// available through the authentication-aware logic in index.ts when explicitly needed.
import './fixture-metadata-runtime-patch.cjs';
import './fixture-display-repair-runtime.cjs';
import './realtime-settlement-runtime-patch.cjs';
import './index.ts';
import './fixture-display-repair';

setTimeout(() => {
  void import('./fixture-display-repair')
    .then(({ repairFixtureDisplayMetadataWithRetry }) => repairFixtureDisplayMetadataWithRetry())
    .catch(error => console.warn('[DB] Deferred fixture display repair could not start:', error));
}, 20_000);
