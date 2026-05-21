import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { canUploadToProgram } from "@/lib/auth/guards";
import { createDeliverableAccessLog } from "@/lib/dataverse/deliverable-access-logs";
import { createDocumentAccessLog } from "@/lib/dataverse/document-access-logs";
import { getVisibleDeliverableById } from "@/lib/dataverse/deliverables";
import { createDocumentMetadata } from "@/lib/dataverse/documents";
import { getProgramById } from "@/lib/dataverse/programs";
import { businessRuleResponse, errorResponse } from "@/lib/errors/business-rules";
import { uploadPdfToSharePoint } from "@/lib/sharepoint/files";

function canCreateDrgSubmission(user: { internalRoles: string[] }) {
  return user.internalRoles.some((role) =>
    ["drg-admin", "drg-program-owner", "drg-staff"].includes(role)
  );
}

export async function POST(request: Request) {
  const session = await auth();

  if (!session?.user) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  if (!canCreateDrgSubmission(session.user)) {
    return NextResponse.json(
      { error: "Only DRG users can create DRG submission documents." },
      { status: 403 }
    );
  }

  const formData = await request.formData().catch(() => null);
  const file = formData?.get("file");
  const deliverableId = String(formData?.get("deliverableId") ?? "");
  const programId = String(formData?.get("programId") ?? "");
  const reviewDueDate = String(formData?.get("reviewDueDate") ?? "");
  const documentDescription = String(formData?.get("documentDescription") ?? "");

  if (!(file instanceof File)) {
    return businessRuleResponse("pdfRequired");
  }

  if (
    file.type !== "application/pdf" ||
    !file.name.toLowerCase().endsWith(".pdf")
  ) {
    return businessRuleResponse("pdfRequired");
  }

  const deliverable = await getVisibleDeliverableById(deliverableId, session.user);
  const program = await getProgramById(programId, session.user);
  if (!deliverable || deliverable.programId !== programId) {
    return NextResponse.json(
      { error: "Deliverable not found or not accessible." },
      { status: 404 }
    );
  }

  if (deliverable.status === "Draft") {
    return NextResponse.json(
      { error: "Draft deliverables must be approved by the program owner before submission." },
      { status: 409 }
    );
  }

  if (!program || !canUploadToProgram(session.user, program)) {
    if (program?.status === "Archived") {
      return businessRuleResponse("archivedProgramUploadBlocked");
    }

    return NextResponse.json(
      { error: "You do not have access to upload documents for this program." },
      { status: 403 }
    );
  }

  try {
    const content = await file.arrayBuffer();
    const sharePointFile = await uploadPdfToSharePoint({
      programId,
      deliverableId,
      programNumber: program.programNumber,
      programName: program.name,
      deliverableNumber: deliverable.deliverableNumber,
      deliverableName: deliverable.title,
      fileName: file.name,
      content,
    });

    const documentId = await createDocumentMetadata({
      programId,
      deliverableId,
      fileName: file.name,
      sizeKb: sharePointFile.sizeKb || Math.ceil(file.size / 1024),
      uploadedByEmail: session.user.email ?? "",
      sharePointSiteUrl: sharePointFile.siteUrl,
      sharePointDriveId: sharePointFile.driveId,
      sharePointItemId: sharePointFile.itemId,
      sharePointUrl: sharePointFile.webUrl,
      documentRole: "DRG Submission",
      reviewDueDate,
      description: documentDescription,
    });

    await createDocumentAccessLog({
      documentId,
      programId,
      actorUserId: session.user.id,
      actorName: session.user.name ?? session.user.email ?? "Signed-in user",
      actorEmail: session.user.email ?? "",
      action: "Upload",
    });

    await createDeliverableAccessLog({
      deliverableId,
      programId,
      documentId,
      actorUserId: session.user.id,
      actorName: session.user.name ?? session.user.email ?? "Signed-in user",
      actorEmail: session.user.email ?? "",
      action: "Document Upload",
      source: "Submit Wizard",
    });

    return NextResponse.json({
      submitted: true,
      documentId,
      submissionRef: sharePointFile.itemId,
      sharePointUrl: sharePointFile.webUrl,
    });
  } catch (error) {
    return errorResponse(error, {
      fallback: "Failed to submit document.",
    });
  }
}
