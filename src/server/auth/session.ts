import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { auth } from "./index";
import {
  canPerformOperatorAction,
  isUserRole,
  type OperatorCapability,
  type UserRole,
} from "./roles";

type OperatorSession = NonNullable<
  Awaited<ReturnType<typeof auth.api.getSession>>
> & {
  user: {
    role: UserRole;
  };
};

export async function getOperatorSession(): Promise<OperatorSession | null> {
  const session = await auth.api.getSession({ headers: await headers() });

  if (!session || !isUserRole(session.user.role)) {
    return null;
  }

  return session as OperatorSession;
}

export async function requireOperator(): Promise<OperatorSession> {
  const session = await getOperatorSession();

  if (!session) {
    redirect("/login");
  }

  return session;
}

export async function getOperatorSessionForCapability(
  capability: OperatorCapability,
): Promise<OperatorSession | null> {
  const session = await getOperatorSession();
  return session && canPerformOperatorAction(session.user.role, capability) ? session : null;
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
