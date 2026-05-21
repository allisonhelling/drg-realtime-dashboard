"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogTitle from "@mui/material/DialogTitle";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import ArchiveOutlinedIcon from "@mui/icons-material/ArchiveOutlined";
import CalendarTodayIcon from "@mui/icons-material/CalendarToday";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import LocationOnIcon from "@mui/icons-material/LocationOn";
import AccessRestrictedNotice from "@/components/AccessRestrictedNotice";
import DocumentsTable from "@/components/DocumentsTable";
import CreateDeliverableDialog from "@/components/CreateDeliverableDialog";
import AnalyticsSummaryCards from "@/components/AnalyticsSummaryCards";
import ProgramOwnerAutocomplete, {
  type ProgramOwnerOption,
} from "@/components/ProgramOwnerAutocomplete";
import ProgramAccessManager from "@/components/ProgramAccessManager";
import RecordsTable from "@/components/RecordsTable";
import { useRole } from "@/lib/context/role-context";
import { normalizeEmail } from "@/lib/auth/roles";
import type { Deliverable, DeliverableType } from "@/lib/models/deliverable";
import type { DeliverableDocument, DocumentAccessLog } from "@/lib/models/document";
import type { Program } from "@/lib/models/program";

function formatDate(iso: string) {
  if (!iso) return "Not set";

  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatMonthKey(monthKey: string) {
  if (!monthKey) return "None";

  const date = new Date(`${monthKey}-01T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return monthKey;

  return date.toLocaleDateString("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

function toDateInputValue(iso: string) {
  return iso ? iso.slice(0, 10) : "";
}

function ProgramDescription({ description }: { description: string }) {
  const [expanded, setExpanded] = useState(false);
  const [canExpand, setCanExpand] = useState(false);
  const descriptionRef = useRef<HTMLParagraphElement | null>(null);

  useEffect(() => {
    const element = descriptionRef.current;
    if (!element) return;

    const updateCanExpand = () => {
      setCanExpand(element.scrollHeight > element.clientHeight + 1);
    };

    updateCanExpand();
    const observer = new ResizeObserver(updateCanExpand);
    observer.observe(element);

    return () => observer.disconnect();
  }, [description, expanded]);

  return (
    <Box sx={{ mb: 2 }}>
      <Typography
        ref={descriptionRef}
        variant="body2"
        sx={{
          color: "text.secondary",
          display: expanded ? "block" : "-webkit-box",
          WebkitBoxOrient: "vertical",
          WebkitLineClamp: expanded ? "unset" : 2,
          overflow: "hidden",
        }}
      >
        {description}
      </Typography>
      {(canExpand || expanded) && (
        <Button
          size="small"
          variant="text"
          onClick={() => setExpanded((current) => !current)}
          sx={{ mt: 0.5, minWidth: 0, p: 0, textTransform: "none" }}
        >
          {expanded ? "See less" : "See more"}
        </Button>
      )}
    </Box>
  );
}

interface ProgramDetailViewProps {
  programId: string;
  initialProgram: Program;
  deliverables: Deliverable[];
  deliverableTypes: DeliverableType[];
  documents: DeliverableDocument[];
  documentCountsByDeliverableId?: Record<string, number>;
  accessLogsByDocumentId?: Record<string, DocumentAccessLog[]>;
}

export default function ProgramDetailView({
  programId,
  initialProgram,
  deliverables,
  deliverableTypes,
  documents,
  documentCountsByDeliverableId: initialDocumentCountsByDeliverableId,
  accessLogsByDocumentId = {},
}: ProgramDetailViewProps) {
  const [activeTab, setActiveTab] = useState(0);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isArchiveDialogOpen, setIsArchiveDialogOpen] = useState(false);
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isArchiving, setIsArchiving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editProgramNumber, setEditProgramNumber] = useState("");
  const [editContractRef, setEditContractRef] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editSites, setEditSites] = useState("");
  const [editStartDate, setEditStartDate] = useState("");
  const [editEndDate, setEditEndDate] = useState("");
  const [editOwnerUpn, setEditOwnerUpn] = useState("");
  const [ownerInput, setOwnerInput] = useState("");
  const [selectedOwner, setSelectedOwner] = useState<ProgramOwnerOption | null>(
    null
  );
  const router = useRouter();
  const { canManageProgramAccess, currentUser, getProgramById, refreshPrograms, role } =
    useRole();
  const program = getProgramById(programId) ?? initialProgram;

  if (!program) {
    return (
      <AccessRestrictedNotice title="Program not found" message="This program could not be found in the current workspace." />
    );
  }

  const activeProgram = program;
  const deliverableMap = Object.fromEntries(
    deliverables.map((d) => [d.id, `${d.deliverableNumber}: ${d.title}`])
  );
  const documentCountsByDeliverableId =
    initialDocumentCountsByDeliverableId ??
    documents.reduce<Record<string, number>>(
      (counts, document) => ({
        ...counts,
        [document.deliverableId]: (counts[document.deliverableId] ?? 0) + 1,
      }),
      {}
    );
  const overdue = deliverables.filter((d) => d.status.startsWith("Overdue")).length;
  const completedDeliverables = deliverables.filter(
    (deliverable) => deliverable.status === "Complete"
  ).length;
  const pendingReview = deliverables.filter((deliverable) =>
    ["Submitted", "In Review"].includes(deliverable.status)
  ).length;
  const submissionsByMonth = documents.reduce<Record<string, number>>(
    (counts, document) => {
      const month = document.uploadedAt.slice(0, 7);
      if (!month) return counts;
      return { ...counts, [month]: (counts[month] ?? 0) + 1 };
    },
    {}
  );
  const busiestMonth = Object.entries(submissionsByMonth).sort(
    ([, a], [, b]) => b - a
  )[0];
  const mayManageProgram =
    canManageProgramAccess(activeProgram.id) ||
    role === "drg-admin" ||
    (role === "drg-program-owner" &&
      activeProgram.access.some(
        (entry) =>
          entry.isActive &&
          entry.accessRole === "Program Owner" &&
          normalizeEmail(entry.email) === normalizeEmail(currentUser?.email)
      ));
  const mayEditProgram = mayManageProgram;
  const mayDeleteProgram = role === "drg-admin";
  const mayChangeOwner = role === "drg-admin";

  function openEditDialog() {
    const ownerOption = activeProgram.ownerUpn
      ? {
          id: activeProgram.ownerUpn,
          email: activeProgram.ownerUpn,
          displayName: activeProgram.ownerName || activeProgram.ownerUpn,
        }
      : null;

    setActionError(null);
    setEditName(activeProgram.name);
    setEditProgramNumber(activeProgram.programNumber);
    setEditContractRef(activeProgram.contractRef);
    setEditDescription(activeProgram.description);
    setEditSites(activeProgram.sites.map((site) => site.name).join(", "));
    setEditStartDate(toDateInputValue(activeProgram.startDate));
    setEditEndDate(toDateInputValue(activeProgram.endDate));
    setEditOwnerUpn(activeProgram.ownerUpn);
    setOwnerInput(activeProgram.ownerName || activeProgram.ownerUpn);
    setSelectedOwner(ownerOption);
    setIsEditDialogOpen(true);
  }

  async function handleSaveProgram() {
    setIsSavingEdit(true);
    setActionError(null);

    try {
      const response = await fetch(`/api/programs/${programId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: editName,
          programNumber: editProgramNumber,
          contractRef: editContractRef,
          description: editDescription,
          sites: editSites.split(",").map((site) => site.trim()).filter(Boolean),
          startDate: editStartDate,
          endDate: editEndDate,
          ...(mayChangeOwner ? { ownerUpn: editOwnerUpn } : {}),
        }),
      });

      if (!response.ok) {
        const json = await response.json().catch(() => null);
        throw new Error(json?.error ?? "Failed to update program.");
      }

      await refreshPrograms();
      setIsEditDialogOpen(false);
      router.refresh();
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "Failed to update program."
      );
    } finally {
      setIsSavingEdit(false);
    }
  }

  async function handleDeleteProgram() {
    setIsDeleting(true);
    setActionError(null);

    try {
      const response = await fetch(`/api/programs/${programId}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        const json = await response.json().catch(() => null);
        throw new Error(json?.error ?? "Failed to delete program.");
      }

      await refreshPrograms();
      setIsDeleteDialogOpen(false);
      router.push("/programs");
      router.refresh();
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "Failed to delete program."
      );
    } finally {
      setIsDeleting(false);
    }
  }

  async function handleArchiveProgram() {
    setIsArchiving(true);
    setActionError(null);

    try {
      const response = await fetch(`/api/programs/${activeProgram.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ action: "archive" }),
      });

      if (!response.ok) {
        const json = await response.json().catch(() => null);
        throw new Error(json?.error ?? "Failed to archive program.");
      }

      await refreshPrograms();
      setIsArchiveDialogOpen(false);
      router.push("/programs/archived");
      router.refresh();
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "Failed to archive program."
      );
    } finally {
      setIsArchiving(false);
    }
  }

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <Box
        sx={{
          bgcolor: "background.paper",
          border: "1px solid",
          borderColor: overdue > 0 ? "error.light" : "divider",
          borderRadius: 1,
          p: 2.5,
        }}
      >
        {actionError && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {actionError}
          </Alert>
        )}

        <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 1, mb: 1.5 }}>
          <Box>
            <Typography variant="h6" sx={{ fontWeight: 700 }}>
              {program.name}
            </Typography>
            <Typography variant="body2" sx={{ fontFamily: "monospace", color: "text.secondary", fontSize: "0.8rem" }}>
              {program.contractRef}
            </Typography>
          </Box>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap", justifyContent: "flex-end" }}>
            {overdue > 0 && (
              <Chip label={`${overdue} overdue`} sx={{ bgcolor: "error.main", color: "#fff", fontWeight: 700 }} />
            )}
            {mayEditProgram && (
              <Button
                variant="outlined"
                size="small"
                startIcon={<EditOutlinedIcon />}
                onClick={openEditDialog}
              >
                Edit
              </Button>
            )}
          </Box>
        </Box>

        <ProgramDescription description={program.description} />

        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 2 }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
            <CalendarTodayIcon sx={{ fontSize: "0.875rem", color: "text.secondary" }} />
            <Typography variant="caption" sx={{ color: "text.secondary" }}>
              {formatDate(program.startDate)} - {formatDate(program.endDate)}
            </Typography>
          </Box>
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, flexWrap: "wrap" }}>
            <LocationOnIcon sx={{ fontSize: "0.875rem", color: "text.secondary" }} />
            <Typography variant="caption" sx={{ color: "text.secondary" }}>
              {program.sites.slice(0, 5).map((site) => site.name).join(", ")}
              {program.sites.length > 5 && ` +${program.sites.length - 5} more`}
            </Typography>
          </Box>
        </Box>
      </Box>

      <AnalyticsSummaryCards
        cards={[
          { label: "Deliverables Completed", value: completedDeliverables },
          { label: "Pending Review", value: pendingReview, alert: pendingReview > 0 },
          { label: "Overdue", value: overdue, alert: overdue > 0 },
          { label: "Top Month", value: busiestMonth ? `${formatMonthKey(busiestMonth[0])} (${busiestMonth[1]})` : "None" },
        ]}
      />

      <Box
        sx={{
          bgcolor: "background.paper",
          border: "1px solid",
          borderColor: "divider",
          borderRadius: 1,
          overflow: "hidden",
        }}
      >
        <Tabs
          value={activeTab}
          onChange={(_, nextValue: number) => setActiveTab(nextValue)}
          variant="scrollable"
          scrollButtons="auto"
          sx={{
            borderBottom: "1px solid",
            borderColor: "divider",
            px: 2,
            pt: 1,
          }}
        >
          <Tab label={`Deliverables (${deliverables.length})`} />
          <Tab label={`Documents (${documents.length})`} />
          <Tab label="Program Access" />
        </Tabs>

        <Box sx={{ p: 2.5 }}>
          {activeTab === 0 && (
            <Box>
              <RecordsTable
                deliverables={deliverables}
                programs={[program]}
                documentCountsByDeliverableId={documentCountsByDeliverableId}
                toolbarActions={
                  <CreateDeliverableDialog
                    programs={[program]}
                    deliverableTypes={deliverableTypes}
                    defaultProgramId={program.id}
                  />
                }
              />
            </Box>
          )}
          {activeTab === 1 && (
            <DocumentsTable
              documents={documents}
              deliverableMap={deliverableMap}
              programs={[program]}
              accessLogsByDocumentId={accessLogsByDocumentId}
            />
          )}
          {activeTab === 2 && <ProgramAccessManager program={program} />}
        </Box>
      </Box>

      <Dialog
        open={isEditDialogOpen}
        onClose={() => {
          if (!isSavingEdit) setIsEditDialogOpen(false);
        }}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Edit Program</DialogTitle>
        <DialogContent dividers>
          <Box sx={{ display: "flex", flexDirection: "column", gap: 2, pt: 0.5 }}>
            <TextField
              label="Program name"
              value={editName}
              onChange={(event) => setEditName(event.target.value)}
              fullWidth
              required
            />
            <TextField
              label="Program number"
              value={editProgramNumber}
              onChange={(event) => setEditProgramNumber(event.target.value)}
              fullWidth
              required
            />
            <TextField
              label="Contract reference"
              value={editContractRef}
              onChange={(event) => setEditContractRef(event.target.value)}
              fullWidth
              required
            />
            {mayChangeOwner && (
              <ProgramOwnerAutocomplete
                value={selectedOwner}
                inputValue={ownerInput}
                required
                onChange={(value) => {
                  setSelectedOwner(value);
                  setEditOwnerUpn(value?.email ?? "");
                }}
                onInputChange={setOwnerInput}
                onError={setActionError}
              />
            )}
            <TextField
              label="Sites"
              placeholder="Norfolk, VA, Tinker AFB, OK"
              value={editSites}
              onChange={(event) => setEditSites(event.target.value)}
              fullWidth
            />
            <TextField
              label="Description"
              value={editDescription}
              onChange={(event) => setEditDescription(event.target.value)}
              fullWidth
              multiline
              minRows={3}
            />
            <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" }, gap: 2 }}>
              <TextField
                label="Start date"
                type="date"
                value={editStartDate}
                onChange={(event) => setEditStartDate(event.target.value)}
                fullWidth
                InputLabelProps={{ shrink: true }}
              />
              <TextField
                label="End date"
                type="date"
                value={editEndDate}
                onChange={(event) => setEditEndDate(event.target.value)}
                fullWidth
                InputLabelProps={{ shrink: true }}
              />
            </Box>
          </Box>
        </DialogContent>
        <DialogActions>
          {mayDeleteProgram && (
            <Box sx={{ display: "flex", gap: 1, mr: "auto", flexWrap: "wrap" }}>
              {activeProgram.status !== "Archived" && (
                <Button
                  color="warning"
                  variant="outlined"
                  startIcon={<ArchiveOutlinedIcon />}
                  onClick={() => {
                    setActionError(null);
                    setIsEditDialogOpen(false);
                    setIsArchiveDialogOpen(true);
                  }}
                  disabled={isSavingEdit}
                >
                  Archive Program
                </Button>
              )}
              <Button
                color="error"
                variant="outlined"
                startIcon={<DeleteOutlineIcon />}
                onClick={() => {
                  setActionError(null);
                  setIsEditDialogOpen(false);
                  setIsDeleteDialogOpen(true);
                }}
                disabled={isSavingEdit}
              >
                Delete Program
              </Button>
            </Box>
          )}
          <Button onClick={() => setIsEditDialogOpen(false)} disabled={isSavingEdit}>
            Cancel
          </Button>
          <Button
            variant="contained"
            disabled={
              isSavingEdit ||
              !editName.trim() ||
              !editProgramNumber.trim() ||
              !editContractRef.trim() ||
              (mayChangeOwner && !editOwnerUpn.trim())
            }
            onClick={handleSaveProgram}
          >
            {isSavingEdit ? "Saving..." : "Save"}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={isArchiveDialogOpen}
        onClose={() => {
          if (!isArchiving) setIsArchiveDialogOpen(false);
        }}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>Archive Program?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            This will move the program out of active program views. Downloads
            remain available, but new uploads are blocked for archived programs.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setIsArchiveDialogOpen(false)} disabled={isArchiving}>
            Cancel
          </Button>
          <Button
            color="warning"
            variant="contained"
            onClick={handleArchiveProgram}
            disabled={isArchiving}
          >
            {isArchiving ? "Archiving..." : "Archive Program"}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={isDeleteDialogOpen}
        onClose={() => {
          if (!isDeleting) setIsDeleteDialogOpen(false);
        }}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>Delete Program?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            This permanently deletes the program only if it is still empty test
            data. Programs with deliverables, documents, approvals, or audit
            logs will be kept.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setIsDeleteDialogOpen(false)} disabled={isDeleting}>
            Cancel
          </Button>
          <Button
            color="error"
            variant="contained"
            onClick={handleDeleteProgram}
            disabled={isDeleting}
          >
            {isDeleting ? "Deleting..." : "Delete Program"}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
