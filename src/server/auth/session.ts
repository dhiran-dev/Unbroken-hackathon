import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { auth } from "./index";
import { isUserRole, type UserRole } from "./roles";

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
