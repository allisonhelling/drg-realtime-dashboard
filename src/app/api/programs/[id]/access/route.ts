import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { canManageProgramAccess, canViewProgram } from "@/lib/auth/guards";
import { normalizeEmail } from "@/lib/auth/roles";
import { createProgramAccess, listProgramAccess, revokeProgramAccess } from "@/lib/dataverse/program-access";
import { getProgramById } from "@/lib/dataverse/programs";
import { businessRuleResponse, errorResponse } from "@/lib/errors/business-rules";
import { getProgramCollaboratorPrincipal } from "@/lib/graph/invitations";

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();

  if (!session?.user) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const { id: programId } = await params;
  const program = await getProgramById(programId, session.user);

  if (!program) {
    return NextResponse.json({ error: "Program not found." }, { status: 404 });
  }

  if (!canViewProgram(session.user, program)) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  const access = await listProgramAccess(programId);
  return NextResponse.json({ access });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();

  if (!session?.user) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const { id: programId } = await params;
  const body = await request.json().catch(() => null);
  const email = normalizeEmail(body?.email);

  if (!isValidEmail(email)) {
    return NextResponse.json({ error: "Valid email is required." }, { status: 400 });
  }

  const program = await getProgramById(programId, session.user);

  if (!program) {
    return NextResponse.json({ error: "Program not found." }, { status: 404 });
  }

  if (!canManageProgramAccess(session.user, program)) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  try {
    const collaborator = await getProgramCollaboratorPrincipal(email);

    if (!collaborator) {
      return businessRuleResponse("externalUserNotReady");
    }

    const access = await createProgramAccess({
      programId,
      programNumber: program.programNumber,
      email: collaborator.email,
      displayName: collaborator.displayName,
      grantedByEmail: session.user.email ?? "",
      accessRole: collaborator.accessRole,
      entraObjectId: collaborator.id,
    });
    return NextResponse.json({
      email: access.email,
      granted: true,
    });
  } catch (error) {
    return errorResponse(error, {
      fallback: "Failed to grant access.",
      duplicateConflict: "duplicateProgramAccess",
    });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();

  if (!session?.user) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const { id: programId } = await params;
  const body = await request.json().catch(() => null);
  const email = normalizeEmail(body?.email);

  if (!isValidEmail(email)) {
    return NextResponse.json({ error: "Valid email is required." }, { status: 400 });
  }

  const program = await getProgramById(programId, session.user);

  if (!program) {
    return NextResponse.json({ error: "Program not found." }, { status: 404 });
  }

  if (!canManageProgramAccess(session.user, program)) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  if (email === normalizeEmail(session.user.email)) {
    return NextResponse.json(
      { error: "You cannot revoke your own access." },
      { status: 400 }
    );
  }

  try {
    await revokeProgramAccess({
      programId,
      email,
    });
    return NextResponse.json({ email, revoked: true });
  } catch (error) {
    return errorResponse(error, {
      fallback: "Failed to revoke access.",
    });
  }
}
