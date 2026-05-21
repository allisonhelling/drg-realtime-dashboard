import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { canWorkProgram } from "@/lib/auth/guards";
import {
  getVisibleDeliverableById,
  updateDeliverableWorkflowStatus,
} from "@/lib/dataverse/deliverables";
import { listVisibleDocuments } from "@/lib/dataverse/documents";
import { getProgramById } from "@/lib/dataverse/programs";
import { businessRuleResponse, errorResponse } from "@/lib/errors/business-rules";

const REVIEWABLE_STATUSES = new Set(["Submitted", "Returned", "Not Submitted"]);

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();

  if (!session?.user) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const { id } = await params;

  try {
    const deliverable = await getVisibleDeliverableById(id, session.user);
    if (!deliverable) {
      return NextResponse.json(
        { error: "Deliverable not found or not accessible." },
        { status: 404 }
      );
    }

    const program = await getProgramById(deliverable.programId, session.user);
    if (!program) {
      return NextResponse.json(
        { error: "Program not found or not accessible." },
        { status: 404 }
      );
    }

    if (!canWorkProgram(session.user, program)) {
      if (program.status === "Archived") {
        return businessRuleResponse("archivedProgramUploadBlocked");
      }

      return NextResponse.json(
        { error: "You do not have access to request review for this program." },
        { status: 403 }
      );
    }

    if (!REVIEWABLE_STATUSES.has(deliverable.status)) {
      return NextResponse.json(
        {
          error:
            "Only submitted or returned deliverables can be marked ready for review.",
        },
        { status: 409 }
      );
    }

    const currentSubmission = (await listVisibleDocuments(session.user, {
      documentRole: "DRG Submission",
    })).find(
      (document) =>
        document.deliverableId === deliverable.id && document.isCurrentVersion
    );

    if (!currentSubmission) {
      return NextResponse.json(
        { error: "Upload a DRG submission PDF before requesting review." },
        { status: 409 }
      );
    }

    await updateDeliverableWorkflowStatus({
      deliverableId: deliverable.id,
      status: "In Review",
    });

    return NextResponse.json({
      readyForReview: true,
      deliverableId: deliverable.id,
      documentId: currentSubmission.id,
    });
  } catch (error) {
    return errorResponse(error, {
      fallback: "Failed to mark deliverable ready for review.",
    });
  }
}
