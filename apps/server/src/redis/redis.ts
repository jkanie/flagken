import { Redis } from 'ioredis';

export const REDIS = Symbol('REDIS');

export function createRedis(url: string, name: string): Redis {
  // maxRetriesPerRequest null: BullMQ workers need blocking commands to wait for a reconnect.
  return new Redis(url, { connectionName: name, maxRetriesPerRequest: null, lazyConnect: false });
}
