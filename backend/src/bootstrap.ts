// Load the CommonJS compatibility patch before index.ts creates the analysis service.
// Start fixture display repair after the database initialization performed by index.ts.
import './fixture-metadata-runtime-patch.cjs';
import './index.ts';

setTimeout(() => {
  void import('./fixture-display-repair')
    .then(({ repairFixtureDisplayMetadataWithRetry }) => repairFixtureDisplayMetadataWithRetry())
    .catch(error => console.warn('[DB] Deferred fixture display repair could not start:', error));
}, 20_000);
