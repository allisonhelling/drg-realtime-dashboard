"use client";

import { useState } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Typography from "@mui/material/Typography";
import AnalyticsSummaryCards from "@/components/AnalyticsSummaryCards";
import EditIcon from "@mui/icons-material/Edit";
import CreateDeliverableDialog from "@/components/CreateDeliverableDialog";
import FilteredRecordsView from "@/components/FilteredRecordsView";
import { useRole } from "@/lib/context/role-context";
import type { Deliverable, DeliverableType } from "@/lib/models/deliverable";
import type { Program } from "@/lib/models/program";

interface RecordsPageViewProps {
  deliverables: Deliverable[];
  programs: Program[];
  deliverableTypes: DeliverableType[];
  documentCountsByDeliverableId: Record<string, number>;
}

export default function RecordsPageView({
  deliverables,
  programs,
  deliverableTypes,
  documentCountsByDeliverableId,
}: RecordsPageViewProps) {
  const [editMode, setEditMode] = useState(false);
  const { canCreateDeliverableForProgram } = useRole();
  const canEditAnyDeliverable = deliverables.some((deliverable) =>
    canCreateDeliverableForProgram(deliverable.programId)
  );
  const currentYear = new Date().getFullYear();
  const completed = deliverables.filter(
    (deliverable) => deliverable.status === "Complete"
  ).length;
  const overdue = deliverables.filter((deliverable) =>
    deliverable.status.startsWith("Overdue")
  ).length;
  const submittedThisYear = deliverables.filter((deliverable) => {
    const submitted = deliverable.lastSubmittedOn || deliverable.lastUpdated;
    return submitted && new Date(submitted).getFullYear() === currentYear;
  }).length;

  return (
    <>
      <Box sx={{ mb: 2.5 }}>
        <Typography variant="h5">Deliverables</Typography>
        <Box
          sx={{
            display: "flex",
            alignItems: { xs: "flex-start", sm: "center" },
            justifyContent: "space-between",
            gap: 2,
            mt: 0.25,
            flexDirection: { xs: "column", sm: "row" },
          }}
        >
          <Typography variant="body2" sx={{ color: "text.secondary" }}>
            All CDRL / SDRL Records across active programs
          </Typography>
          <Box sx={{ display: "flex", gap: 1, alignItems: "center", flexWrap: "wrap", flexShrink: 0 }}>
            {canEditAnyDeliverable && (
              <Button
                variant={editMode ? "contained" : "outlined"}
                color={editMode ? "warning" : "primary"}
                size="small"
                startIcon={<EditIcon />}
                onClick={() => setEditMode((value) => !value)}
              >
                {editMode ? "Editing" : "Edit"}
              </Button>
            )}
            <CreateDeliverableDialog
              programs={programs}
              deliverableTypes={deliverableTypes}
            />
          </Box>
        </Box>
      </Box>
      <Box sx={{ mb: 2 }}>
        <AnalyticsSummaryCards
          cards={[
            { label: "Total Shown", value: deliverables.length },
            { label: "Completed", value: completed },
            { label: "Overdue", value: overdue, alert: overdue > 0 },
            { label: `Submitted ${currentYear}`, value: submittedThisYear },
          ]}
        />
      </Box>
      <FilteredRecordsView
        deliverables={deliverables}
        programs={programs}
        editMode={editMode}
        documentCountsByDeliverableId={documentCountsByDeliverableId}
      />
    </>
  );
}
