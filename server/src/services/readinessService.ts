import mongoose from 'mongoose';
import { getMeiliClient } from '../utils/meiliClient';

export const READINESS_PROBE_TIMEOUT_MS = 2_000;

export type ReadinessProbe = () => Promise<unknown>;

export interface ReadinessProbes {
  mongo: ReadinessProbe;
  search: ReadinessProbe;
}

export interface Readiness {
  mongo: boolean;
  search: boolean;
}

const pingMongo: ReadinessProbe = async () => {
  const db = mongoose.connection.readyState === 1 ? mongoose.connection.db : undefined;
  if (!db) throw new Error('MongoDB is not connected');
  await db.admin().ping();
};

const checkMeiliHealth: ReadinessProbe = async () => {
  const client = await getMeiliClient();
  const health = await client.health();
  if (health?.status !== 'available') throw new Error('Meilisearch is not available');
};

export const defaultReadinessProbes: ReadinessProbes = {
  mongo: pingMongo,
  search: checkMeiliHealth,
};

const probeSucceedsWithin = (probe: ReadinessProbe, timeoutMs: number): Promise<boolean> =>
  new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    const settle = (ready: boolean) => {
      clearTimeout(timer);
      resolve(ready);
    };
    Promise.resolve()
      .then(probe)
      .then(
        () => settle(true),
        () => settle(false),
      );
  });

export const checkReadiness = async (
  probes: ReadinessProbes = defaultReadinessProbes,
  timeoutMs: number = READINESS_PROBE_TIMEOUT_MS,
): Promise<Readiness> => {
  const [mongo, search] = await Promise.all([
    probeSucceedsWithin(probes.mongo, timeoutMs),
    probeSucceedsWithin(probes.search, timeoutMs),
  ]);
  return { mongo, search };
};

export const isReady = (readiness: Readiness): boolean => readiness.mongo && readiness.search;
