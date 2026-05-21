"use client";

import Typography from "@mui/material/Typography";
import Box from "@mui/material/Box";
import AnalyticsSummaryCards from "@/components/AnalyticsSummaryCards";
import DocumentsTable from "@/components/DocumentsTable";
import type { Deliverable } from "@/lib/models/deliverable";
import type { DeliverableDocument, DocumentAccessLog } from "@/lib/models/document";
import type { Program } from "@/lib/models/program";

interface FilteredDocumentsViewProps {
  documents: DeliverableDocument[];
  deliverables: Deliverable[];
  programs: Program[];
  accessLogsByDocumentId?: Record<string, DocumentAccessLog[]>;
}

export default function FilteredDocumentsView({
  documents,
  deliverables,
  programs,
  accessLogsByDocumentId = {},
}: FilteredDocumentsViewProps) {
  const visiblePrograms = programs;
  const visibleProgramIds = new Set(visiblePrograms.map((program) => program.id));
  const visibleDocuments = documents.filter((document) =>
    visibleProgramIds.has(document.programId)
  );
  const visibleDeliverables = deliverables.filter((deliverable) =>
    visibleProgramIds.has(deliverable.programId)
  );
  const deliverableMap = Object.fromEntries(
    visibleDeliverables.map((d) => [d.id, `${d.deliverableNumber}: ${d.title}`])
  );
  const currentYear = new Date().getFullYear();
  const submittedThisYear = visibleDocuments.filter(
    (document) => new Date(document.uploadedAt).getFullYear() === currentYear
  ).length;
  const completed = visibleDocuments.filter((document) =>
    ["Final", "Reviewed"].includes(document.status)
  ).length;
  const overdue = visibleDocuments.filter((document) =>
    document.status.startsWith("Overdue")
  ).length;

  if (visiblePrograms.length === 0) {
    return (
      <Typography variant="body2" sx={{ color: "text.secondary" }}>
        No documents are available because this account is not assigned to any programs.
      </Typography>
    );
  }

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <AnalyticsSummaryCards
        cards={[
          { label: "Total Shown", value: visibleDocuments.length },
          { label: "Completed", value: completed },
          { label: "Overdue", value: overdue, alert: overdue > 0 },
          { label: `Submitted ${currentYear}`, value: submittedThisYear },
        ]}
      />
      <DocumentsTable
        documents={visibleDocuments}
        deliverableMap={deliverableMap}
        programs={visiblePrograms}
        accessLogsByDocumentId={accessLogsByDocumentId}
        detailSource="documents"
        showUploadAction={false}
        showSearch
      />
    </Box>
  );
}
