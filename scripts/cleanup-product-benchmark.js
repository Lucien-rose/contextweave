#!/usr/bin/env node
import assert from 'node:assert/strict';
import { qdrantConfig, deleteQdrantCollection } from '../server/src/vector-store.js';
import { vectorIndexIdentity } from '../server/src/vector/identity.js';
import { vectorProviderConfig } from '../server/src/vector-provider.js';

const provider=vectorProviderConfig();
const store=qdrantConfig({indexIdentity:vectorIndexIdentity(provider),dimensions:provider.dimensions});
assert.match(store.collection,/^cw_eval_[a-z0-9_]*_[a-f0-9]{16}$/,'Refusing to delete a non-benchmark Qdrant collection');
await deleteQdrantCollection(store);
process.stdout.write(`${JSON.stringify({deleted_test_collection:store.collection})}\n`);
