import { createDb, createPool, type Db } from "./client";

// One pool per web server process, created on first use. Worker jobs don't
// use this: they create and close their own pool (see createPool).
const holder = globalThis as unknown as { __hubDb?: Promise<Db> };

export function getDb(): Promise<Db> {
  holder.__hubDb ??= createPool()
    .then(({ pool }) => createDb(pool))
    .catch((err: unknown) => {
      holder.__hubDb = undefined;
      throw err;
    });
  return holder.__hubDb;
}
