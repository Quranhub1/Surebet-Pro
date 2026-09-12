// Load the CommonJS compatibility patch before index.ts creates the analysis service.
// This guarantees provider payloads are normalized before fixtures are persisted.
import './fixture-metadata-runtime-patch.cjs';
import './index.ts';
import './fixture-display-repair';
