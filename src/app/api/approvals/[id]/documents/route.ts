import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { canSubmitApprovalDecision } from "@/lib/auth/guards";
import {
  createDeliverableAccessLog,
  hasDeliverableDocumentDownloadByActor,
} from "@/lib/dataverse/deliverable-access-logs";
import {
  createDocumentAccessLog,
  hasDocumentDownloadByActor,
} from "@/lib/dataverse/document-access-logs";
import { getApprovalById } from "@/lib/dataverse/approvals";
import { getVisibleDeliverableById } from "@/lib/dataverse/deliverables";
import { createDocumentMetadata } from "@/lib/dataverse/documents";
import { getProgramById } from "@/lib/dataverse/programs";
import { businessRuleResponse, errorResponse } from "@/lib/errors/business-rules";
import type { DocumentRole } from "@/lib/models/document";
import { uploadPdfToSharePoint } from "@/lib/sharepoint/files";

function getDocumentRole(value: FormDataEntryValue | null): DocumentRole | undefined {
  if (value === "Reviewer Response" || value === "Signed Approval") {
    return value;
  }

  return undefined;
}

export async function POST(
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

  if (!canSubmitApprovalDecision(session.user, program, approval)) {
    return businessRuleResponse("reviewerAccessRequired");
  }

  const deliverable = await getVisibleDeliverableById(
    approval.deliverableId,
    session.user
  );

  if (!deliverable || deliverable.programId !== program.id) {
    return NextResponse.json({ error: "Deliverable not found." }, { status: 404 });
  }

  const formData = await request.formData().catch(() => null);
  const file = formData?.get("file");
  const documentRole = getDocumentRole(formData?.get("documentRole") ?? null);
  const description = String(formData?.get("documentDescription") ?? "");

  if (!(file instanceof File)) {
    return businessRuleResponse("pdfRequired");
  }

  if (
    file.type !== "application/pdf" ||
    !file.name.toLowerCase().endsWith(".pdf")
  ) {
    return businessRuleResponse("pdfRequired");
  }

  if (!documentRole) {
    return NextResponse.json(
      { error: "Document role must be Reviewer Response or Signed Approval." },
      { status: 400 }
    );
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

  try {
    const content = await file.arrayBuffer();
    const sharePointFile = await uploadPdfToSharePoint({
      programId: program.id,
      deliverableId: deliverable.id,
      programNumber: program.programNumber,
      programName: program.name,
      deliverableNumber: deliverable.deliverableNumber,
      deliverableName: deliverable.title,
      fileName: file.name,
      content,
    });

    const documentId = await createDocumentMetadata({
      programId: program.id,
      deliverableId: deliverable.id,
      fileName: file.name,
      sizeKb: sharePointFile.sizeKb || Math.ceil(file.size / 1024),
      uploadedByEmail: session.user.email ?? "",
      sharePointSiteUrl: sharePointFile.siteUrl,
      sharePointDriveId: sharePointFile.driveId,
      sharePointItemId: sharePointFile.itemId,
      sharePointUrl: sharePointFile.webUrl,
      documentRole,
      parentDocumentId: approval.documentId,
      approvalId: approval.id,
      description,
    });

    await createDocumentAccessLog({
      documentId,
      programId: program.id,
      actorUserId: session.user.id,
      actorName: session.user.name ?? session.user.email ?? "Signed-in user",
      actorEmail: session.user.email ?? "",
      action: "Upload",
    });

    await createDeliverableAccessLog({
      deliverableId: deliverable.id,
      programId: program.id,
      documentId,
      approvalId: approval.id,
      actorUserId: session.user.id,
      actorName: session.user.name ?? session.user.email ?? "Signed-in user",
      actorEmail: session.user.email ?? "",
      action: "Document Upload",
      source: "Review Dialog",
    });

    return NextResponse.json({
      uploaded: true,
      documentId,
      documentRole,
      sharePointUrl: sharePointFile.webUrl,
    });
  } catch (error) {
    return errorResponse(error, {
      fallback: "Failed to upload approval document.",
    });
  }
}
