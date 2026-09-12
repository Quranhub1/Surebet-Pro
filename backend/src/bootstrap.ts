// Load runtime compatibility patches before index.ts creates the analysis service.
// This guarantees provider payloads are normalized before fixtures are persisted.
import './fixture-metadata-runtime-patch.js';
import './index.ts';
