import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import type { Approval } from "@/lib/models/approval";
import type { Program, ProgramAccess, ProgramAccessRole } from "@/lib/models/program";
import type { EffectiveRole, InternalRole } from "@/lib/auth/roles";
import { hasAnyRole, normalizeEmail } from "@/lib/auth/roles";

export async function requireUser() {
  const session = await auth();

  if (!session?.user) {
    redirect("/signin");
  }

  return session.user;
}

export async function requireInternalRole(allowedRoles: readonly InternalRole[]) {
  const user = await requireUser();

  if (!hasAnyRole(user.internalRoles, allowedRoles)) {
    redirect("/unauthorized");
  }

  return user;
}

export function getEffectiveRolesForProgram(
  user: { email?: string | null; internalRoles: InternalRole[] },
  program?: Program
): EffectiveRole[] {
  const roles = new Set<EffectiveRole>();

  for (const role of user.internalRoles) {
    roles.add(role);
  }

  const userEmail = normalizeEmail(user.email);
  const activeAccess = getActiveProgramAccess(program, userEmail);

  if (activeAccess) {
    roles.add("gov-reviewer");
  }

  return [...roles];
}

export function isProgramArchived(program: Program) {
  return program.status === "Archived";
}

export function getActiveProgramAccess(
  program: Program | undefined,
  email: string | null | undefined
): ProgramAccess | undefined {
  const userEmail = normalizeEmail(email);
  if (!program || !userEmail) return undefined;

  return program.access.find(
    (entry) => entry.isActive && normalizeEmail(entry.email) === userEmail
  );
}

function hasActiveProgramAccessWithRole(
  program: Program,
  email: string | null | undefined,
  allowedRoles?: readonly ProgramAccessRole[]
) {
  const access = getActiveProgramAccess(program, email);
  if (!access) return false;
  return allowedRoles ? allowedRoles.includes(access.accessRole) : true;
}

export function canViewProgram(
  user: { email?: string | null; internalRoles: InternalRole[] },
  program: Program
) {
  if (user.internalRoles.includes("drg-admin")) return true;

  return Boolean(getActiveProgramAccess(program, user.email));
}

export function canCreateProgram(user: { internalRoles: InternalRole[] }) {
  return user.internalRoles.includes("drg-admin");
}

export function canDeleteProgram(user: { internalRoles: InternalRole[] }) {
  return user.internalRoles.includes("drg-admin");
}

export function canDeleteDeliverable(
  user: { email?: string | null; internalRoles: InternalRole[] },
  program: Program,
  documentCount: number
) {
  void documentCount;

  if (isProgramArchived(program)) return false;
  if (user.internalRoles.includes("drg-admin")) return true;

  if (!user.internalRoles.includes("drg-program-owner")) {
    return false;
  }

  return hasActiveProgramAccessWithRole(program, user.email, ["Program Owner"]);
}

export function canDeleteDocument(
  user: { email?: string | null; internalRoles: InternalRole[] },
  program: Program
) {
  return canDeleteDeliverable(user, program, 0);
}

export function canManageProgramAccess(
  user: { email?: string | null; internalRoles: InternalRole[] },
  program: Program
) {
  if (user.internalRoles.includes("drg-admin")) return true;

  if (!user.internalRoles.includes("drg-program-owner")) {
    return false;
  }

  return hasActiveProgramAccessWithRole(program, user.email, ["Program Owner"]);
}

export function canWorkProgram(
  user: { email?: string | null; internalRoles: InternalRole[] },
  program: Program
) {
  if (isProgramArchived(program)) return false;
  if (user.internalRoles.includes("drg-admin")) return true;

  if (
    user.internalRoles.includes("drg-program-owner") ||
    user.internalRoles.includes("drg-staff")
  ) {
    return hasActiveProgramAccessWithRole(program, user.email, [
      "DRG Staff",
      "Program Owner",
    ]);
  }

  return false;
}

export function canCreateApprovedDeliverable(
  user: { email?: string | null; internalRoles: InternalRole[] },
  program: Program
) {
  if (isProgramArchived(program)) return false;
  if (user.internalRoles.includes("drg-admin")) return true;

  if (user.internalRoles.includes("drg-program-owner")) {
    return hasActiveProgramAccessWithRole(program, user.email, ["Program Owner"]);
  }

  return false;
}

export function canCreateDeliverableDraft(
  user: { email?: string | null; internalRoles: InternalRole[] },
  program: Program
) {
  if (isProgramArchived(program)) return false;
  if (
    !user.internalRoles.includes("drg-staff") &&
    !user.internalRoles.includes("drg-program-owner")
  ) {
    return false;
  }

  return hasActiveProgramAccessWithRole(program, user.email, [
    "DRG Staff",
    "Program Owner",
  ]);
}

export function canCreateDeliverable(
  user: { email?: string | null; internalRoles: InternalRole[] },
  program: Program
) {
  return (
    canCreateApprovedDeliverable(user, program) ||
    canCreateDeliverableDraft(user, program)
  );
}

export function canApproveDeliverableDraft(
  user: { email?: string | null; internalRoles: InternalRole[] },
  program: Program
) {
  return canCreateApprovedDeliverable(user, program);
}

export function canUploadToProgram(
  user: { email?: string | null; internalRoles: InternalRole[] },
  program: Program
) {
  if (isProgramArchived(program)) return false;
  if (user.internalRoles.includes("drg-admin")) return true;

  if (user.internalRoles.includes("external-reviewer")) {
    return hasActiveProgramAccessWithRole(program, user.email, [
      "External Reviewer",
    ]);
  }

  return canWorkProgram(user, program);
}

export function canDownloadFromProgram(
  user: { email?: string | null; internalRoles: InternalRole[] },
  program: Program
) {
  return canViewProgram(user, program);
}

export function canSubmitApprovalDecision(
  user: { email?: string | null; internalRoles: InternalRole[] },
  program: Program,
  approval: Approval | undefined
) {
  if (!approval?.isCurrent) return false;
  if (approval.programId !== program.id) return false;
  if (isProgramArchived(program)) return false;
  if (!user.internalRoles.includes("external-reviewer")) return false;
  if (normalizeEmail(approval.reviewerEmail) !== normalizeEmail(user.email)) {
    return false;
  }

  return hasActiveProgramAccessWithRole(program, user.email, [
    "External Reviewer",
  ]);
}

export function assertCanViewProgram(
  user: { email?: string | null; internalRoles: InternalRole[] },
  program: Program | undefined
) {
  if (!program) notFound();

  if (!canViewProgram(user, program)) {
    redirect("/unauthorized");
  }
}

export function assertCanUploadToProgram(
  user: { email?: string | null; internalRoles: InternalRole[] },
  program: Program | undefined
) {
  if (!program) notFound();

  if (!canUploadToProgram(user, program)) {
    redirect("/unauthorized");
  }
}
