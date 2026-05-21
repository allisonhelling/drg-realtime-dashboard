import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { canDeleteProgram, canManageProgramAccess } from "@/lib/auth/guards";
import { normalizeEmail } from "@/lib/auth/roles";
import {
  archiveProgram,
  deleteEmptyProgram,
  getProgramById,
  listPrograms,
  updateProgram,
} from "@/lib/dataverse/programs";
import {
  businessRuleResponse,
  errorResponse,
} from "@/lib/errors/business-rules";
import {
  deleteProgramFolder,
  isSharePointUploadConfigured,
  renameProgramFolder,
} from "@/lib/sharepoint/files";

function requiredString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();

  if (!session?.user) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const { id } = await params;
  const program = await getProgramById(id, session.user);

  if (!program) {
    return NextResponse.json(
      { error: "Program not found or not accessible." },
      { status: 404 }
    );
  }

  if (!canManageProgramAccess(session.user, program)) {
    return NextResponse.json(
      { error: "Only DRG admins or the assigned program owner can edit this program." },
      { status: 403 }
    );
  }

  const body = await request.json().catch(() => null);
  const isAdmin = session.user.internalRoles.includes("drg-admin");

  if (body?.action === "archive") {
    if (!isAdmin) {
      return NextResponse.json(
        { error: "Only DRG admins can archive programs." },
        { status: 403 }
      );
    }

    if (program.status === "Archived") {
      return NextResponse.json({ archived: true, programId: id });
    }

    try {
      await archiveProgram({
        programId: id,
        archivedByEmail: normalizeEmail(session.user.email),
      });
      return NextResponse.json({ archived: true, programId: id });
    } catch (error) {
      return errorResponse(error, {
        fallback: "Failed to archive program.",
      });
    }
  }

  const name = requiredString(body?.name);
  const programNumber = requiredString(body?.programNumber);
  const contractRef = requiredString(body?.contractRef);
  const description = requiredString(body?.description);
  const startDate = requiredString(body?.startDate);
  const endDate = requiredString(body?.endDate);
  const ownerUpn = normalizeEmail(body?.ownerUpn);
  const sites = Array.isArray(body?.sites)
    ? body.sites.map(requiredString).filter(Boolean)
    : [];

  if (!name || !programNumber || !contractRef) {
    return NextResponse.json(
      { error: "Program name, program number, and contract reference are required." },
      { status: 400 }
    );
  }

  const normalizedExistingOwner = normalizeEmail(program.ownerUpn);
  const nextOwnerUpn = ownerUpn || normalizedExistingOwner;

  if (!isAdmin && nextOwnerUpn !== normalizedExistingOwner) {
    return NextResponse.json(
      { error: "Only DRG admins can change the program owner." },
      { status: 403 }
    );
  }

  try {
    const existingPrograms = await listPrograms();
    if (
      existingPrograms.some(
        (existingProgram) =>
          existingProgram.id !== id &&
          existingProgram.programNumber.trim().toLowerCase() ===
            programNumber.toLowerCase()
      )
    ) {
      return businessRuleResponse("duplicateProgramNumber");
    }

    await updateProgram({
      programId: id,
      name,
      programNumber,
      contractRef,
      description,
      sites,
      startDate,
      endDate,
      ownerUpn: isAdmin ? nextOwnerUpn : undefined,
    });

    if (
      isSharePointUploadConfigured() &&
      (program.programNumber !== programNumber || program.name !== name)
    ) {
      await renameProgramFolder({
        oldProgramNumber: program.programNumber,
        oldProgramName: program.name,
        programNumber,
        programName: name,
        legacyProgramId: id,
      });
    }

    return NextResponse.json({ updated: true, programId: id });
  } catch (error) {
    return errorResponse(error, {
      fallback: "Failed to update program.",
      duplicateConflict: "duplicateProgramNumber",
    });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();

  if (!session?.user) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  if (!canDeleteProgram(session.user)) {
    return NextResponse.json(
      { error: "Only DRG admins can delete programs." },
      { status: 403 }
    );
  }

  const { id } = await params;
  const program = await getProgramById(id, session.user);

  if (!program) {
    return NextResponse.json(
      { error: "Program not found or not accessible." },
      { status: 404 }
    );
  }

  try {
    if (isSharePointUploadConfigured()) {
      await deleteProgramFolder({
        programNumber: program.programNumber,
        programName: program.name,
        legacyProgramId: id,
      });
    }

    await deleteEmptyProgram(id);
    return NextResponse.json({ deleted: true, programId: id });
  } catch (error) {
    return errorResponse(error, {
      fallback: "Failed to delete program.",
    });
  }
}
