import './fixture-metadata-runtime-patch.cjs';
import './fixture-display-repair-runtime.cjs';
import './realtime-settlement-runtime-patch.cjs';
import './index.ts';
import './football-provider-fallback-runtime-patch.cjs';

setTimeout(() => {
  void import('./fixture-display-repair')
    .then(({ repairFixtureDisplayMetadataWithRetry }) => repairFixtureDisplayMetadataWithRetry())
    .catch(error => console.warn('[DB] Deferred fixture display repair could not start:', error));
}, 20_000);