import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { canCreateProgram } from "@/lib/auth/guards";
import { normalizeEmail } from "@/lib/auth/roles";
import { createProgram, listPrograms, listVisiblePrograms } from "@/lib/dataverse/programs";
import { businessRuleResponse, errorResponse } from "@/lib/errors/business-rules";
import {
  ensureProgramFolder,
  isSharePointUploadConfigured,
} from "@/lib/sharepoint/files";

export async function GET() {
  const session = await auth();

  if (!session?.user) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const programs = await listVisiblePrograms(session.user);
  return NextResponse.json({ programs });
}

function requiredString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export async function POST(request: Request) {
  const session = await auth();

  if (!session?.user) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  if (!canCreateProgram(session.user)) {
    return NextResponse.json(
      { error: "Only DRG admins can create programs." },
      { status: 403 }
    );
  }

  const body = await request.json().catch(() => null);
  const name = requiredString(body?.name);
  const programNumber = requiredString(body?.programNumber);
  const contractRef = requiredString(body?.contractRef);
  const ownerUpn = normalizeEmail(body?.ownerUpn ?? session.user.email);
  const creatorUpn = normalizeEmail(session.user.email);
  const sites = Array.isArray(body?.sites)
    ? body.sites.map(requiredString).filter(Boolean)
    : [];

  if (!name || !programNumber || !contractRef || !ownerUpn || !creatorUpn) {
    return NextResponse.json(
      {
        error:
          "Program name, program number, contract reference, owner, and creator are required.",
      },
      { status: 400 }
    );
  }

  try {
    const existingPrograms = await listPrograms();
    if (
      existingPrograms.some(
        (program) =>
          program.programNumber.trim().toLowerCase() ===
          programNumber.toLowerCase()
      )
    ) {
      return businessRuleResponse("duplicateProgramNumber");
    }

    const programId = await createProgram({
      name,
      programNumber,
      contractRef,
      description: requiredString(body?.description),
      sites,
      startDate: requiredString(body?.startDate),
      endDate: requiredString(body?.endDate),
      ownerUpn,
      creatorUpn,
    });

    let sharePointProvisioningWarning: string | undefined;

    if (isSharePointUploadConfigured()) {
      try {
        await ensureProgramFolder({
          programNumber,
          programName: name,
        });
      } catch (error) {
        console.error("SharePoint folder provisioning failed after program creation", {
          programId,
          error,
        });
        sharePointProvisioningWarning =
          "Program was created, but SharePoint folder provisioning failed. Document uploads may fail until SharePoint app permissions are fixed.";
      }
    }

    return NextResponse.json(
      {
        programId,
        created: true,
        sharePointFolderReady: !sharePointProvisioningWarning,
        ...(sharePointProvisioningWarning
          ? { warning: sharePointProvisioningWarning }
          : {}),
      },
      { status: 201 }
    );
  } catch (error) {
    return errorResponse(error, {
      fallback: "Failed to create program.",
      duplicateConflict: "duplicateProgramNumber",
    });
  }
}
