// Load the CommonJS compatibility patch before index.ts creates the analysis service.
// Fixture display repair is invoked by index.ts only after the database is initialized.
import './fixture-metadata-runtime-patch.cjs';
import './index.ts';
