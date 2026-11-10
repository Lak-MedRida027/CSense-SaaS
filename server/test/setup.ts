import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { ensureLearningIndexes } from '../src/db/learningIndexes.js';
import { configureAudit, createAuditService } from '../src/features/audit/audit.service.js';
import { testChainSecret } from './helpers/testConfig.js';
import { afterAll, afterEach, beforeAll } from 'vitest';

let mongod: MongoMemoryServer | undefined;

beforeAll(async () => {
  // Tests that call the audit facade without building an app still write to the chain.
  configureAudit(createAuditService({ chainSecret: testChainSecret }));
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  await ensureLearningIndexes();
});

afterEach(async () => {
  const { collections } = mongoose.connection;
  await Promise.all(Object.values(collections).map((c) => c.deleteMany({})));
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod?.stop();
});
