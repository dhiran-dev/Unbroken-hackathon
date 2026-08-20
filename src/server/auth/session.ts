import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { auth } from "./index";
import {
  canPerformOperatorAction,
  isOperatorRole,
  isRiderRole,
  type OperatorCapability,
  type OperatorRole,
  type UserRole,
} from "./roles";

type AuthSession = NonNullable<
  Awaited<ReturnType<typeof auth.api.getSession>>
> & {
  user: {
    role: UserRole;
  };
};

type OperatorSession = AuthSession & {
  user: {
    role: OperatorRole;
  };
};

export type RiderSession = AuthSession & {
  user: {
    role: "rider";
  };
};

async function getSession(): Promise<AuthSession | null> {
  return (await auth.api.getSession({
    headers: await headers(),
  })) as AuthSession | null;
}

export async function getOperatorSession(): Promise<OperatorSession | null> {
  const session = await getSession();

  if (!session || !isOperatorRole(session.user.role)) {
    return null;
  }

  return session as OperatorSession;
}

export async function getRiderSession(): Promise<RiderSession | null> {
  const session = await getSession();

  if (!session || !isRiderRole(session.user.role)) {
    return null;
  }

  return session as RiderSession;
}

export async function requireOperator(): Promise<OperatorSession> {
  const session = await getOperatorSession();

  if (!session) {
    redirect("/login");
  }

  return session;
}

export async function requireRider(): Promise<RiderSession> {
  const session = await getRiderSession();

  if (!session) {
    redirect("/rider/sign-in");
  }

  return session;
}

export async function getOperatorSessionForCapability(
  capability: OperatorCapability,
): Promise<OperatorSession | null> {
  const session = await getOperatorSession();
  return session && canPerformOperatorAction(session.user.role, capability)
    ? session
    : null;
}

export async function requireOperatorCapability(
  capability: OperatorCapability,
): Promise<OperatorSession> {
  const session = await getOperatorSession();

  if (!session) {
    redirect("/login");
  }

  if (!canPerformOperatorAction(session.user.role, capability)) {
    redirect("/admin");
  }

  return session;
}
