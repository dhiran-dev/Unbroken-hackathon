import { randomUUID } from "node:crypto";

import { hashPassword } from "better-auth/crypto";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { db, sql } from "@/server/db/client";
import { account, user } from "@/server/db/schema/auth";
import type { UserRole } from "@/server/auth/roles";

const credentialSchema = z.object({
  email: z.string().email(),
  password: z.string().min(14).max(128),
  role: z.enum(["owner", "admin"]),
  name: z.string().min(1),
});

const candidates = [
  {
    email: process.env.OWNER_EMAIL,
    password: process.env.OWNER_PASSWORD,
    role: "owner" as const,
    name: "UNBROKEN Owner",
  },
  {
    email: process.env.JUDGE_ADMIN_EMAIL,
    password: process.env.JUDGE_ADMIN_PASSWORD,
    role: "admin" as const,
    name: "Judge Admin",
  },
].filter((candidate) => candidate.email || candidate.password);

if (candidates.length === 0) {
  throw new Error(
    "Set OWNER_EMAIL/OWNER_PASSWORD and/or JUDGE_ADMIN_EMAIL/JUDGE_ADMIN_PASSWORD before running this command.",
  );
}

async function createAccount(input: {
  email: string;
  password: string;
  role: UserRole;
  name: string;
}) {
  const normalizedEmail = input.email.trim().toLowerCase();
  const existing = await db.query.user.findFirst({
    where: eq(user.email, normalizedEmail),
  });

  if (existing) {
    if (existing.role !== input.role) {
      throw new Error(
        `Account ${normalizedEmail} already exists with a different role.`,
      );
    }

    process.stdout.write(`Account already exists: ${normalizedEmail}\n`);
    return;
  }

  const userId = randomUUID();
  const now = new Date();
  const passwordHash = await hashPassword(input.password);

  await db.transaction(async (transaction) => {
    await transaction.insert(user).values({
      id: userId,
      name: input.name,
      email: normalizedEmail,
      emailVerified: true,
      role: input.role,
      createdAt: now,
      updatedAt: now,
    });

    await transaction.insert(account).values({
      id: randomUUID(),
      issuer: "local:credential",
      accountId: userId,
      providerId: "credential",
      userId,
      password: passwordHash,
      createdAt: now,
      updatedAt: now,
    });
  });

  process.stdout.write(`Created ${input.role}: ${normalizedEmail}\n`);
}

try {
  for (const candidate of candidates) {
    await createAccount(credentialSchema.parse(candidate));
  }
} finally {
  await sql.end();
}
