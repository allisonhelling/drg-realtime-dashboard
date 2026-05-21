import { notFound } from "next/navigation";
import { Suspense } from "react";
import Box from "@mui/material/Box";
import Container from "@mui/material/Container";
import CircularProgress from "@mui/material/CircularProgress";
import BackButton from "@/components/BackButton";
import DeliverableDetail from "@/components/DeliverableDetail";
import { assertCanViewProgram, requireUser } from "@/lib/auth/guards";
import { listVisibleApprovals } from "@/lib/dataverse/approvals";
import {
  createDeliverableAccessLog,
  listDeliverableAccessLogs,
  shouldCreateDeliverableAccessLog,
} from "@/lib/dataverse/deliverable-access-logs";
import { listDocumentAccessLogs } from "@/lib/dataverse/document-access-logs";
import { getVisibleDeliverableById, listVisibleDeliverables } from "@/lib/dataverse/deliverables";
import { listDocumentIdsForDeliverable, listVisibleDocuments } from "@/lib/dataverse/documents";
import { getProgramById, listVisiblePrograms } from "@/lib/dataverse/programs";

async function DeliverableDetailContent({ id, user }: { id: string; user: Awaited<ReturnType<typeof requireUser>> }) {
  const [deliverables, documents, programs, approvals] = await Promise.all([
    listVisibleDeliverables(user),
    listVisibleDocuments(user),
    listVisiblePrograms(user),
    listVisibleApprovals(user),
  ]);

  const deliverable = deliverables.find((d) => d.id === id);
  if (!deliverable) notFound();

  const linkedDocs = documents.filter((doc) => doc.deliverableId === id);
  const documentIds = await listDocumentIdsForDeliverable(id);
  const program = programs.find((p) => p.id === deliverable.programId);
  const [accessLogMap, deliverableAccessLogMap] = await Promise.all([
    listDocumentAccessLogs(linkedDocs.map((doc) => doc.id)),
    listDeliverableAccessLogs([id]),
  ]);
  const accessLogCountsByDocumentId = Object.fromEntries(
    [...accessLogMap].map(([documentId, logs]) => [documentId, logs.length])
  );
  const accessLogsByDocumentId = Object.fromEntries(accessLogMap);
  const deliverableAccessLogs = deliverableAccessLogMap.get(id) ?? [];

  return (
    <DeliverableDetail
      deliverable={deliverable}
      documents={linkedDocs}
      approvals={approvals.filter((approval) => approval.deliverableId === id)}
      documentCount={documentIds.length}
      program={program}
      accessLogCountsByDocumentId={accessLogCountsByDocumentId}
      accessLogsByDocumentId={accessLogsByDocumentId}
      deliverableAccessLogs={deliverableAccessLogs}
    />
  );
}

function getFirstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

async function getDeliverableBackConfig(
  id: string,
  from: string | string[] | undefined,
  user: Awaited<ReturnType<typeof requireUser>>
) {
  if (getFirstValue(from) === "records") {
    return {
      href: "/records",
      label: "All Deliverables",
    };
  }

  const deliverable = await getVisibleDeliverableById(id, user);
  if (!deliverable) notFound();
  return {
    href: `/programs/${deliverable.programId}`,
    label: "Program Overview",
  };
}

export default async function RecordPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string | string[] }>;
}) {
  const user = await requireUser();
  const [{ id }, { from }] = await Promise.all([params, searchParams]);
  const deliverable = await getVisibleDeliverableById(id, user);
  const program = deliverable
    ? await getProgramById(deliverable.programId, user)
    : undefined;

  assertCanViewProgram(user, program);

  if (
    deliverable &&
    shouldCreateDeliverableAccessLog({
      action: "View",
      internalRoles: user.internalRoles,
    })
  ) {
    await createDeliverableAccessLog({
      deliverableId: deliverable.id,
      programId: deliverable.programId,
      actorUserId: user.id,
      actorName: user.name ?? user.email ?? "Signed-in user",
      actorEmail: user.email ?? "",
      action: "View",
      source: "Deliverable Page",
    });
  }

  const backConfig = await getDeliverableBackConfig(id, from, user);

  return (
    <Container maxWidth="md" sx={{ py: { xs: 3, sm: 4 } }}>
      <BackButton href={backConfig.href}>{backConfig.label}</BackButton>
      <Suspense
        fallback={
          <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
            <CircularProgress />
          </Box>
        }
      >
        <DeliverableDetailContent id={id} user={user} />
      </Suspense>
    </Container>
  );
}
