import { NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  getApprovalById,
  submitApprovalDecision,
} from "@/lib/dataverse/approvals";
import { hasDeliverableDocumentDownloadByActor } from "@/lib/dataverse/deliverable-access-logs";
import { hasDocumentDownloadByActor } from "@/lib/dataverse/document-access-logs";
import { getVisibleDocumentById } from "@/lib/dataverse/documents";
import { getProgramById } from "@/lib/dataverse/programs";
import { businessRuleResponse, errorResponse } from "@/lib/errors/business-rules";
import type { ApprovalDecision } from "@/lib/models/approval";

function toDecision(value: unknown): Exclude<ApprovalDecision, "Pending"> | undefined {
  return value === "Approved" || value === "Rejected" ? value : undefined;
}

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

  const { id: approvalId } = await params;
  const approval = await getApprovalById(approvalId);

  if (!approval) {
    return NextResponse.json({ error: "Approval not found." }, { status: 404 });
  }

  const program = await getProgramById(approval.programId, session.user);

  if (!program) {
    return NextResponse.json({ error: "Program not found." }, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  const decision = toDecision(body?.decision);
  const comments = requiredString(body?.comments);
  const responseDocumentId = requiredString(body?.responseDocumentId);

  if (!decision) {
    return NextResponse.json(
      { error: "Decision must be Approved or Rejected." },
      { status: 400 }
    );
  }

  if (decision === "Rejected" && !comments) {
    return businessRuleResponse("rejectionCommentsRequired");
  }

  if (decision === "Approved" && !responseDocumentId) {
    return businessRuleResponse("signedApprovalPdfRequired");
  }

  const hasDownloadedSubmission =
    (await hasDocumentDownloadByActor({
      documentId: approval.documentId,
      actorEmail: session.user.email,
    })) ||
    (await hasDeliverableDocumentDownloadByActor({
      deliverableId: approval.deliverableId,
      documentId: approval.documentId,
      approvalId: approval.id,
      actorEmail: session.user.email,
    }));

  if (!hasDownloadedSubmission) {
    return businessRuleResponse("reviewedDocumentDownloadRequired");
  }

  if (responseDocumentId) {
    const responseDocument = await getVisibleDocumentById(
      responseDocumentId,
      session.user
    );

    if (!responseDocument || responseDocument.programId !== approval.programId) {
      return NextResponse.json(
        { error: "Response document not found or not accessible." },
        { status: 404 }
      );
    }

    if (
      responseDocument.parentDocumentId &&
      responseDocument.parentDocumentId !== approval.documentId
    ) {
      return NextResponse.json(
        { error: "Response document is not linked to this submission." },
        { status: 409 }
      );
    }

    if (decision === "Approved" && responseDocument.documentRole !== "Signed Approval") {
      return businessRuleResponse("signedApprovalPdfRequired");
    }
  }

  try {
    await submitApprovalDecision({
      user: session.user,
      program,
      approval,
      approvalId: approval.id,
      decision,
      comments,
      responseDocumentId,
    });

    return NextResponse.json({ updated: true, approvalId: approval.id, decision });
  } catch (error) {
    return errorResponse(error, {
      fallback: "Failed to submit approval decision.",
    });
  }
}
