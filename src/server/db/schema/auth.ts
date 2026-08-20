import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  uuid,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const user = pgTable(
  "user",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    emailVerified: boolean("email_verified").default(false).notNull(),
    image: text("image"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    role: text("role").default("rider").notNull(),
    banned: boolean("banned").default(false).notNull(),
    banReason: text("ban_reason"),
    banExpires: timestamp("ban_expires", { withTimezone: true }),
  },
  (table) => [uniqueIndex("user_email_uidx").on(table.email)],
);

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    token: text("token").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    impersonatedBy: text("impersonated_by"),
  },
  (table) => [
    uniqueIndex("session_token_uidx").on(table.token),
    index("session_user_id_idx").on(table.userId),
    index("session_expires_at_idx").on(table.expiresAt),
  ],
);

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    issuer: text("issuer").notNull(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", {
      withTimezone: true,
    }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", {
      withTimezone: true,
    }),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("account_user_id_idx").on(table.userId),
    uniqueIndex("account_issuer_account_id_uidx").on(
      table.issuer,
      table.accountId,
    ),
  ],
);

export const verification = pgTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [index("verification_identifier_idx").on(table.identifier)],
);

export const riderProfiles = pgTable("rider_profiles", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const signupCapacity = pgTable(
  "signup_capacity",
  {
    id: integer("id").default(1).primaryKey(),
    maxAccounts: integer("max_accounts").default(40).notNull(),
    activeAccounts: integer("active_accounts").default(0).notNull(),
    reservedAccounts: integer("reserved_accounts").default(0).notNull(),
    admissionState: text("admission_state").default("open").notNull(),
    emailCircuitState: text("email_circuit_state").default("closed").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check("signup_capacity_singleton_ck", sql`${table.id} = 1`),
    check("signup_capacity_fixed_cap_ck", sql`${table.maxAccounts} = 40`),
    check(
      "signup_capacity_nonnegative_counts_ck",
      sql`${table.activeAccounts} >= 0 AND ${table.reservedAccounts} >= 0`,
    ),
    check(
      "signup_capacity_within_cap_ck",
      sql`${table.activeAccounts} + ${table.reservedAccounts} <= ${table.maxAccounts}`,
    ),
    check(
      "signup_capacity_admission_state_ck",
      sql`${table.admissionState} IN ('open', 'paused')`,
    ),
    check(
      "signup_capacity_email_circuit_state_ck",
      sql`${table.emailCircuitState} IN ('closed', 'open', 'paused')`,
    ),
  ],
);

export const signupReservations = pgTable(
  "signup_reservations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    capacityId: integer("capacity_id")
      .default(1)
      .notNull()
      .references(() => signupCapacity.id, { onDelete: "restrict" }),
    email: text("email").notNull(),
    userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
    status: text("status").default("reserved").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true })
      .default(sql`now() + interval '10 minutes'`)
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("signup_reservations_capacity_idx").on(table.capacityId),
    index("signup_reservations_email_idx").on(table.email),
    index("signup_reservations_user_id_idx").on(table.userId),
    index("signup_reservations_expiry_idx").on(table.expiresAt),
    index("signup_reservations_status_expiry_idx").on(
      table.status,
      table.expiresAt,
    ),
    check(
      "signup_reservations_status_ck",
      sql`${table.status} IN ('reserved', 'activated', 'released', 'expired')`,
    ),
  ],
);
