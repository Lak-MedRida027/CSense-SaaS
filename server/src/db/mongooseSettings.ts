import mongoose from 'mongoose';

/**
 * Global Mongoose settings. Imported by `models/index.ts` so the API, the bootstrap script and the
 * tests all run with identical behaviour.
 * - strictQuery: filters on unknown paths are dropped, never passed through.
 * - sanitizeFilter: any `$`-operator that arrives inside a filter value is wrapped in `$eq`, a second
 *   layer against NoSQL operator injection behind zod validation.
 */
mongoose.set('strictQuery', true);
mongoose.set('sanitizeFilter', true);
