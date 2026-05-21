import { NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  canCreateApprovedDeliverable,
  canCreateDeliverable,
} from "@/lib/auth/guards";
import {
  createDeliverable,
  listVisibleDeliverables,
} from "@/lib/dataverse/deliverables";
import { listDeliverableTypes } from "@/lib/dataverse/deliverable-types";
import { getProgramById } from "@/lib/dataverse/programs";
import { businessRuleResponse, errorResponse } from "@/lib/errors/business-rules";
import {
  ensureDeliverableFolder,
  isSharePointUploadConfigured,
} from "@/lib/sharepoint/files";

export async function GET() {
  const session = await auth();

  if (!session?.user) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const deliverables = await listVisibleDeliverables(session.user);
  return NextResponse.json({ deliverables });
}

function requiredString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getNextDeliverableNumber(input: {
  programNumber: string;
  existingNumbers: string[];
}) {
  const prefix = input.programNumber.trim();
  const pattern = new RegExp(`^${escapeRegExp(prefix)}-(\\d{3,})$`, "i");
  let nextSequence = 1;

  for (const number of input.existingNumbers) {
    const match = number.trim().match(pattern);
    if (!match) continue;

    const sequence = Number(match[1]);
    if (Number.isInteger(sequence)) {
      nextSequence = Math.max(nextSequence, sequence + 1);
    }
  }

  return `${prefix}-${String(nextSequence).padStart(3, "0")}`;
}

export async function POST(request: Request) {
  const session = await auth();

  if (!session?.user) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const programId = requiredString(body?.programId);
  const title = requiredString(body?.title);
  const requestedDeliverableNumber = requiredString(body?.deliverableNumber);
  const typeId = requiredString(body?.typeId);
  const dueDate = requiredString(body?.dueDate);

  if (!programId || !title || !typeId || !dueDate) {
    return NextResponse.json(
      {
        error:
          "Program, title, type, and due date are required.",
      },
      { status: 400 }
    );
  }

  try {
    const program = await getProgramById(programId, session.user);
    if (!program) {
      return NextResponse.json(
        { error: "Program not found or not accessible." },
        { status: 404 }
      );
    }

    if (!canCreateDeliverable(session.user, program)) {
      if (program.status === "Archived") {
        return businessRuleResponse("archivedProgramUploadBlocked");
      }

      return NextResponse.json(
        { error: "You do not have access to create deliverables for this program." },
        { status: 403 }
      );
    }

    const [existingDeliverables, deliverableTypes] = await Promise.all([
      listVisibleDeliverables(session.user),
      listDeliverableTypes(),
    ]);
    const programDeliverables = existingDeliverables.filter(
      (deliverable) => deliverable.programId === programId
    );
    const deliverableNumber =
      requestedDeliverableNumber ||
      getNextDeliverableNumber({
        programNumber: program.programNumber,
        existingNumbers: programDeliverables.map(
          (deliverable) => deliverable.deliverableNumber
        ),
      });

    if (
      programDeliverables.some(
        (deliverable) =>
          deliverable.deliverableNumber.trim().toLowerCase() ===
            deliverableNumber.toLowerCase()
      )
    ) {
      return businessRuleResponse("duplicateDeliverableNumber");
    }

    const deliverableType = deliverableTypes.find((type) => type.id === typeId);
    if (!deliverableType) {
      return NextResponse.json(
        { error: "Deliverable type not found or inactive." },
        { status: 400 }
      );
    }

    const createdAsDraft = !canCreateApprovedDeliverable(session.user, program);
    const deliverableId = await createDeliverable({
      programId,
      title,
      deliverableNumber,
      typeId,
      dueDate,
      contractRef: program.contractRef,
      description: requiredString(body?.description),
      assignedToEmail: requiredString(body?.assignedToEmail),
      status: createdAsDraft ? "Draft" : "Not Submitted",
    });

    let sharePointProvisioningWarning: string | undefined;

    if (isSharePointUploadConfigured()) {
      try {
        await ensureDeliverableFolder({
          programId,
          programNumber: program.programNumber,
          programName: program.name,
          deliverableId,
          deliverableNumber,
          deliverableName: title,
        });
      } catch (error) {
        console.error("SharePoint folder provisioning failed after deliverable creation", {
          deliverableId,
          programId,
          error,
        });
        sharePointProvisioningWarning =
          "Deliverable was created, but SharePoint folder provisioning failed. Document uploads may fail until SharePoint app permissions are fixed.";
      }
    }

    return NextResponse.json(
      {
        deliverableId,
        deliverableNumber,
        created: true,
        status: createdAsDraft ? "Draft" : "Not Submitted",
        requiresProgramOwnerApproval: createdAsDraft,
        sharePointFolderReady: !sharePointProvisioningWarning,
        ...(sharePointProvisioningWarning
          ? { warning: sharePointProvisioningWarning }
          : {}),
      },
      { status: 201 }
    );
  } catch (error) {
    return errorResponse(error, {
      fallback: "Failed to create deliverable.",
      duplicateConflict: "duplicateDeliverableNumber",
    });
  }
}
