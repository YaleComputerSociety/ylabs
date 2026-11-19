/**
 * One paid OpenAI call: who made it, which model, and the tokens it billed (#5523).
 * Written by `utils/modelClient.ts` for every call that reached the network, so the
 * spend of each lane and script can be read with `yarn --cwd server model-usage:report`.
 *
 * Environment-local by policy, listed in scripts/mirrorCollectionPolicy.ts: each entry is
 * a call this environment's processes made, so a copy would bill one environment's spend
 * to another.
 */
import mongoose from 'mongoose';
import '../db/devWriteGuard';

export const MODEL_CALL_USAGE_COLLECTION = 'model_call_usages';

const modelCallUsageSchema = new mongoose.Schema(
  {
    caller: { type: String, required: true },
    endpoint: { type: String, required: true },
    model: { type: String, required: true },
    succeeded: { type: Boolean, required: true },
    promptTokens: { type: Number, required: true, default: 0 },
    cachedPromptTokens: { type: Number, required: true, default: 0 },
    completionTokens: { type: Number, required: true, default: 0 },
    reasoningTokens: { type: Number, required: true, default: 0 },
    durationMs: { type: Number, required: true, default: 0 },
    calledAt: { type: Date, required: true },
  },
  { timestamps: false, versionKey: false },
);

export const MODEL_CALL_USAGE_RETENTION_SECONDS = 365 * 24 * 60 * 60;

modelCallUsageSchema.index(
  { calledAt: 1 },
  { expireAfterSeconds: MODEL_CALL_USAGE_RETENTION_SECONDS },
);

export const ModelCallUsage = mongoose.model(
  'ModelCallUsage',
  modelCallUsageSchema,
  MODEL_CALL_USAGE_COLLECTION,
);

export { modelCallUsageSchema };
