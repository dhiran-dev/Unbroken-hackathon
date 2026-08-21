import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { getServerEnv } from "@/lib/env";
import * as schema from "./schema";

const globalForDatabase = globalThis as unknown as {
  unbrokenSql?: ReturnType<typeof postgres>;
};

const connection =
  globalForDatabase.unbrokenSql ??
  postgres(getServerEnv().DATABASE_URL, {
    max: process.env.NODE_ENV === "production" ? 10 : 3,
    idle_timeout: 20,
    connect_timeout: 10,
    prepare: false,
  });

if (process.env.NODE_ENV !== "production") {
  globalForDatabase.unbrokenSql = connection;
}

export const sql = connection;
export const db = drizzle(connection, { schema });
