import type { Schema } from 'mongoose';

/** Rejects aggregation pipelines that write (merge or out stages), which bypass every other guard. */
export function rejectAggregateWrites(
  schema: Schema,
  makeError: (operation: string) => Error,
): void {
  schema.pre('aggregate', function (this: { pipeline(): object[] }) {
    const writes = this.pipeline().some((stage) => '$merge' in stage || '$out' in stage);
    if (writes) throw makeError('aggregate with $merge or $out');
  });
}

/**
 * Makes a collection append-only at the model layer: every update, replace and delete path throws
 * `makeError(operation)`; only `create` and `insertMany` write. The raw driver or a DB user with
 * write rights can still modify the collection (Phase 10: restrict the DB role).
 */
export function appendOnly(schema: Schema, makeError: (operation: string) => Error): void {
  const reject = (operation: string) => () => {
    throw makeError(operation);
  };

  schema.pre('save', function (this: { isNew: boolean }) {
    if (!this.isNew) throw makeError('save on an existing document');
  });

  for (const op of [
    'updateOne',
    'updateMany',
    'findOneAndUpdate',
    'replaceOne',
    'findOneAndReplace',
    'deleteMany',
    'findOneAndDelete',
  ] as const) {
    schema.pre(op, reject(op));
  }
  // updateOne/deleteOne also exist on documents (doc.updateOne(), doc.deleteOne()).
  schema.pre('updateOne', { document: true, query: true }, reject('updateOne'));
  schema.pre('deleteOne', { document: true, query: true }, reject('deleteOne'));
  schema.pre('bulkWrite', reject('bulkWrite'));
  rejectAggregateWrites(schema, makeError);
}
