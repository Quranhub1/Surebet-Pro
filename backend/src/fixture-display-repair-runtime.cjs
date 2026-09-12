console.log('[DB] Fixture runtime repair module loaded; repair scheduled for 30 seconds after process start.');
setTimeout(() => {
  import('./fixture-display-repair.ts')
    .then(({ repairFixtureDisplayMetadataWithRetry }) => repairFixtureDisplayMetadataWithRetry())
    .catch(error => console.error('[DB] Fixture runtime repair failed to start:', error instanceof Error ? error.message : error));
}, 30000);
