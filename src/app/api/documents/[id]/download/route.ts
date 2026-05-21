import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { canDownloadFromProgram, getActiveProgramAccess } from "@/lib/auth/guards";
import { createDeliverableAccessLog } from "@/lib/dataverse/deliverable-access-logs";
import {
  createDocumentAccessLog,
  shouldCreateDocumentAccessLog,
} from "@/lib/dataverse/document-access-logs";
import { getVisibleDocumentById } from "@/lib/dataverse/documents";
import { getProgramById } from "@/lib/dataverse/programs";
import { fetchSharePointFile } from "@/lib/sharepoint/files";

function getSafeDownloadFileName(fileName: string) {
  const cleaned = fileName.replace(/[/\\\r\n"]/g, "_").trim();
  return cleaned || "document.pdf";
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();

  if (!session?.user) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const { id } = await params;
  const document = await getVisibleDocumentById(id, session.user);

  if (!document) {
    return NextResponse.json({ error: "Document not found." }, { status: 404 });
  }

  const program = await getProgramById(document.programId, session.user);

  if (!program || !canDownloadFromProgram(session.user, program)) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  if (!document.sharePointDriveId || !document.sharePointItemId) {
    return NextResponse.json(
      { error: "Document does not have SharePoint file identifiers." },
      { status: 404 }
    );
  }

  const activeProgramAccess = getActiveProgramAccess(program, session.user.email);
  const isExternalReviewerAccess =
    activeProgramAccess?.accessRole === "External Reviewer";

  if (
    isExternalReviewerAccess ||
    shouldCreateDocumentAccessLog({
      action: "Download",
      internalRoles: session.user.internalRoles,
    })
  ) {
    await createDocumentAccessLog({
      documentId: document.id,
      programId: document.programId,
      actorUserId: session.user.id,
      actorName: session.user.name ?? session.user.email ?? "Signed-in user",
      actorEmail: session.user.email ?? "",
      action: "Download",
    });
  }

  await createDeliverableAccessLog({
    deliverableId: document.deliverableId,
    programId: document.programId,
    documentId: document.id,
    approvalId: document.approvalId,
    actorUserId: session.user.id,
    actorName: session.user.name ?? session.user.email ?? "Signed-in user",
    actorEmail: session.user.email ?? "",
    action: "Document Download",
    source: "Download API",
  });

  try {
    const fileResponse = await fetchSharePointFile({
      driveId: document.sharePointDriveId,
      itemId: document.sharePointItemId,
    });

    const headers = new Headers({
      "Cache-Control": "private, no-store",
      "Content-Disposition": `attachment; filename="${getSafeDownloadFileName(
        document.fileName
      )}"`,
      "Content-Type": fileResponse.headers.get("content-type") ?? "application/pdf",
    });
    const contentLength = fileResponse.headers.get("content-length");

    if (contentLength) {
      headers.set("Content-Length", contentLength);
    }

    return new Response(fileResponse.body, { status: 200, headers });
  } catch (error) {
    console.error("SharePoint download failed", error);
    return NextResponse.json(
      { error: "Unable to retrieve the document from SharePoint." },
      { status: 502 }
    );
  }
}
