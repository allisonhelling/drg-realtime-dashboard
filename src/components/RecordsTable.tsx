"use client";

import { useState, useMemo, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Autocomplete from "@mui/material/Autocomplete";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import TableSortLabel from "@mui/material/TableSortLabel";
import Paper from "@mui/material/Paper";
import Chip from "@mui/material/Chip";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import FormControl from "@mui/material/FormControl";
import InputAdornment from "@mui/material/InputAdornment";
import InputLabel from "@mui/material/InputLabel";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import Alert from "@mui/material/Alert";
import Tooltip from "@mui/material/Tooltip";
import SearchIcon from "@mui/icons-material/Search";
import type { SelectChangeEvent } from "@mui/material/Select";
import type { Deliverable, DeliverableStatus } from "@/lib/models/deliverable";
import { DELIVERABLE_STATUSES } from "@/lib/models/deliverable";
import type { Program } from "@/lib/models/program";
import { useRole } from "@/lib/context/role-context";
import { normalizeEmail } from "@/lib/auth/roles";

type SortableKey =
  | "deliverableNumber"
  | "title"
  | "type"
  | "status"
  | "dueDate"
  | "createdOn"
  | "assignedTo";
type Order = "asc" | "desc";

const STATUS_CHIP_STYLE: Partial<Record<DeliverableStatus, object>> = {
  Draft: { bgcolor: "#5c6bc0", color: "#fff" },
  "Not Submitted": {},
  "In Review": { bgcolor: "#0078d4", color: "#fff" },
  Returned: { bgcolor: "#ed6c02", color: "#fff" },
  "Pending Acknowledgment": { bgcolor: "#6d4c41", color: "#fff" },
  Complete: { bgcolor: "#2e7d32", color: "#fff" },
  Submitted: { bgcolor: "#00695c", color: "#fff" },
  "Overdue - Waiting on Reviewer": { bgcolor: "#d32f2f", color: "#fff" },
  "Overdue - Waiting on DRG": { bgcolor: "#d32f2f", color: "#fff" },
};

function getStatusChipProps(status: DeliverableStatus) {
  if (status === "Not Submitted") return { color: "default" as const };
  return { sx: STATUS_CHIP_STYLE[status] };
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString();
}

/*
 * Older deliverables may store an email in assignedTo. Keep that email in the
 * tooltip, but prefer the Entra display name as the visible label.
 */
function getAssignedToDisplay(deliverable: Deliverable, programs: Program[]) {
  const program = programs.find((entry) => entry.id === deliverable.programId);
  const assignedToEmail = getAssignedToEmail(deliverable);
  const displayName =
    program?.access.find(
      (entry) => normalizeEmail(entry.email) === normalizeEmail(assignedToEmail)
    )?.displayName ?? deliverable.assignedTo;

  return normalizeEmail(displayName) === normalizeEmail(assignedToEmail) ||
    displayName.includes("@")
    ? "Unknown user"
    : displayName;
}

function getAssignedToEmail(deliverable: Deliverable) {
  return deliverable.assignedToEmail || deliverable.assignedTo;
}

function getAssignedToSortValue(deliverable: Deliverable, programs: Program[]) {
  const displayName = getAssignedToDisplay(deliverable, programs);
  return displayName === "Unknown user"
    ? getAssignedToEmail(deliverable)
    : displayName;
}

function descendingComparator(
  a: Deliverable,
  b: Deliverable,
  key: SortableKey,
  programs: Program[]
): number {
  const aVal = key === "assignedTo" ? getAssignedToSortValue(a, programs) : a[key] ?? "";
  const bVal = key === "assignedTo" ? getAssignedToSortValue(b, programs) : b[key] ?? "";
  if (bVal < aVal) return -1;
  if (bVal > aVal) return 1;
  return 0;
}

function getComparator(order: Order, orderBy: SortableKey, programs: Program[]) {
  return order === "desc"
    ? (a: Deliverable, b: Deliverable) =>
        descendingComparator(a, b, orderBy, programs)
    : (a: Deliverable, b: Deliverable) =>
        -descendingComparator(a, b, orderBy, programs);
}

interface AssignedToOption {
  email: string;
  displayName?: string;
}

interface RecordsTableProps {
  deliverables: Deliverable[];
  programs: Program[];
  detailSource?: "records";
  editMode?: boolean;
  showSearch?: boolean;
  showProgramColumn?: boolean;
  toolbarActions?: ReactNode;
  documentCountsByDeliverableId?: Record<string, number>;
}

export default function RecordsTable({
  deliverables,
  programs,
  detailSource,
  editMode = false,
  showSearch = false,
  showProgramColumn = false,
  toolbarActions,
  documentCountsByDeliverableId = {},
}: RecordsTableProps) {
  void documentCountsByDeliverableId;

  const router = useRouter();
  const searchParams = useSearchParams();
  const { canCreateDeliverableForProgram } = useRole();
  const requestedStatus = searchParams.get("status");
  const initialStatus =
    requestedStatus &&
    DELIVERABLE_STATUSES.includes(requestedStatus as DeliverableStatus)
      ? requestedStatus
      : "All";
  const [statusFilter, setStatusFilter] = useState<string>(initialStatus);
  const [typeFilter, setTypeFilter] = useState<string>("All");
  const [programFilter, setProgramFilter] = useState<string>("All");
  const [searchQuery, setSearchQuery] = useState("");
  const [orderBy, setOrderBy] = useState<SortableKey>("dueDate");
  const [order, setOrder] = useState<Order>("asc");
  const [editingDeliverable, setEditingDeliverable] = useState<Deliverable | null>(null);
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editDueDate, setEditDueDate] = useState("");
  const [editAssignedToEmail, setEditAssignedToEmail] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);

  const programMap = useMemo(
    () => Object.fromEntries(programs.map((p) => [p.id, p.name])),
    [programs]
  );
  const deliverableTypes = useMemo(
    () => [...new Set(deliverables.map((d) => d.type))].sort(),
    [deliverables]
  );
  const programCounts = useMemo(
    () =>
      deliverables.reduce<Record<string, number>>((counts, deliverable) => {
        counts[deliverable.programId] = (counts[deliverable.programId] ?? 0) + 1;
        return counts;
      }, {}),
    [deliverables]
  );
  const statusCounts = useMemo(
    () =>
      deliverables.reduce<Record<string, number>>((counts, deliverable) => {
        counts[deliverable.status] = (counts[deliverable.status] ?? 0) + 1;
        return counts;
      }, {}),
    [deliverables]
  );
  const typeCounts = useMemo(
    () =>
      deliverables.reduce<Record<string, number>>((counts, deliverable) => {
        counts[deliverable.type] = (counts[deliverable.type] ?? 0) + 1;
        return counts;
      }, {}),
    [deliverables]
  );
  const assignedToOptions = useMemo(() => {
    const options = new Map<string, AssignedToOption>();

    for (const program of programs) {
      if (program.ownerUpn) {
        options.set(normalizeEmail(program.ownerUpn), {
          email: program.ownerUpn,
          displayName: program.ownerName,
        });
      }

      for (const entry of program.access) {
        if (!entry.isActive || !entry.email) continue;
        options.set(normalizeEmail(entry.email), {
          email: entry.email,
          displayName: entry.displayName,
        });
      }
    }

    return [...options.values()];
  }, [programs]);

  const filtered = useMemo(() => {
    const normalizedSearchQuery = searchQuery.trim().toLowerCase();
    let rows = deliverables;
    if (statusFilter !== "All") rows = rows.filter((d) => d.status === statusFilter);
    if (typeFilter !== "All") rows = rows.filter((d) => d.type === typeFilter);
    if (programFilter !== "All") rows = rows.filter((d) => d.programId === programFilter);
    if (normalizedSearchQuery) {
      rows = rows.filter((d) =>
        [
          d.deliverableNumber,
          d.title,
          d.type,
          d.status,
          getAssignedToDisplay(d, programs),
          programMap[d.programId] ?? d.programId,
        ].some((value) => value.toLowerCase().includes(normalizedSearchQuery))
      );
    }
    return rows.slice().sort(getComparator(order, orderBy, programs));
  }, [deliverables, statusFilter, typeFilter, programFilter, searchQuery, order, orderBy, programMap, programs]);

  const handleSort = (column: SortableKey) => {
    const isAsc = orderBy === column && order === "asc";
    setOrder(isAsc ? "desc" : "asc");
    setOrderBy(column);
  };

  function openEditDialog(deliverable: Deliverable) {
    setEditingDeliverable(deliverable);
    setEditTitle(deliverable.title);
    setEditDescription(deliverable.description);
    setEditDueDate(deliverable.dueDate.slice(0, 10));
    setEditAssignedToEmail(deliverable.assignedToEmail ?? "");
    setActionError(null);
  }

  async function handleSaveEdit() {
    if (!editingDeliverable) return;

    setIsSavingEdit(true);
    setActionError(null);
    try {
      const response = await fetch(`/api/deliverables/${editingDeliverable.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          title: editTitle,
          description: editDescription,
          dueDate: editDueDate,
          assignedToEmail: editAssignedToEmail,
        }),
      });

      if (!response.ok) {
        const json = await response.json().catch(() => null);
        throw new Error(json?.error ?? "Failed to update deliverable.");
      }

      setEditingDeliverable(null);
      router.refresh();
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "Failed to update deliverable."
      );
    } finally {
      setIsSavingEdit(false);
    }
  }

  const showProgramFilter = programs.length > 1;
  const includeProgramColumn = showProgramColumn || showProgramFilter;
  const recordLabel = filtered.length === 1 ? "record" : "records";
  return (
    <Box>
      {actionError && <Alert severity="error" sx={{ mb: 2 }}>{actionError}</Alert>}

      {/* Filter controls */}
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 2, mb: 2, flexWrap: "wrap" }}>
        <Box sx={{ display: "flex", gap: 2, flexWrap: "wrap" }}>
          {showProgramFilter && (
            <FormControl size="small" sx={{ minWidth: 180 }}>
              <InputLabel id="program-filter-label">Program</InputLabel>
              <Select
                labelId="program-filter-label"
                value={programFilter}
                label="Program"
                onChange={(e: SelectChangeEvent) => setProgramFilter(e.target.value)}
              >
                <MenuItem value="All">All Programs ({deliverables.length})</MenuItem>
                {programs.map((p) => (
                  <MenuItem key={p.id} value={p.id}>
                    {p.name} ({programCounts[p.id] ?? 0})
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          )}

          <FormControl size="small" sx={{ minWidth: 160 }}>
            <InputLabel id="status-filter-label">Status</InputLabel>
            <Select
              labelId="status-filter-label"
              value={statusFilter}
              label="Status"
              onChange={(e: SelectChangeEvent) => setStatusFilter(e.target.value)}
            >
              <MenuItem value="All">All Statuses ({deliverables.length})</MenuItem>
              {DELIVERABLE_STATUSES.map((s) => (
                <MenuItem key={s} value={s}>{s} ({statusCounts[s] ?? 0})</MenuItem>
              ))}
            </Select>
          </FormControl>

          <FormControl size="small" sx={{ minWidth: 130 }}>
            <InputLabel id="type-filter-label">Type</InputLabel>
            <Select
              labelId="type-filter-label"
              value={typeFilter}
              label="Type"
              onChange={(e: SelectChangeEvent) => setTypeFilter(e.target.value)}
            >
              <MenuItem value="All">All Types ({deliverables.length})</MenuItem>
              {deliverableTypes.map((t) => (
                <MenuItem key={t} value={t}>{t} ({typeCounts[t] ?? 0})</MenuItem>
              ))}
            </Select>
          </FormControl>
          <Typography variant="body2" sx={{ color: "text.secondary", alignSelf: "center" }}>
            Displaying {filtered.length} {recordLabel}
          </Typography>
        </Box>
        {(showSearch || toolbarActions) && (
          <Box sx={{ display: "flex", alignItems: "center", gap: 1, ml: "auto", flexWrap: "wrap", justifyContent: "flex-end" }}>
            {showSearch && (
            <TextField
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search deliverables"
              size="small"
              sx={{ minWidth: { xs: "100%", sm: 280 } }}
              slotProps={{
                input: {
                  startAdornment: (
                    <InputAdornment position="start">
                      <SearchIcon fontSize="small" />
                    </InputAdornment>
                  ),
                },
              }}
            />
            )}
            {toolbarActions}
          </Box>
        )}
      </Box>

      {/* Table */}
      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              {[
                { key: "deliverableNumber" as SortableKey, label: "Deliverable Number" },
                { key: "title" as SortableKey, label: "Title" },
                { key: "type" as SortableKey, label: "Type" },
                { key: "status" as SortableKey, label: "Status" },
                { key: "dueDate" as SortableKey, label: "Due Date" },
                { key: "createdOn" as SortableKey, label: "Created On" },
                { key: "assignedTo" as SortableKey, label: "Assigned To" },
              ].map((col) => (
                <TableCell key={col.key} sortDirection={orderBy === col.key ? order : false}>
                  <TableSortLabel
                    active={orderBy === col.key}
                    direction={orderBy === col.key ? order : "asc"}
                    onClick={() => handleSort(col.key)}
                    sx={{ fontWeight: 700 }}
                  >
                    {col.label}
                  </TableSortLabel>
                </TableCell>
              ))}
              {includeProgramColumn && <TableCell sx={{ fontWeight: 700 }}>Associated Program</TableCell>}
            </TableRow>
          </TableHead>

          <TableBody>
            {filtered.map((d) => {
              const assignedToDisplay = getAssignedToDisplay(d, programs);
              const assignedToEmail = getAssignedToEmail(d);
              const canEdit = canCreateDeliverableForProgram(d.programId);

              return (
                <TableRow
                  key={d.id}
                  hover
                  onClick={() => {
                    if (editMode) {
                      if (canEdit) openEditDialog(d);
                      return;
                    }

                    router.push(detailSource ? `/records/${d.id}?from=${detailSource}` : `/records/${d.id}`);
                  }}
                  sx={{
                    cursor: editMode && !canEdit ? "not-allowed" : "pointer",
                    opacity: editMode && !canEdit ? 0.55 : 1,
                  }}
                >
                  <TableCell sx={{ fontFamily: "monospace", fontSize: "0.8rem", color: "primary.main", fontWeight: 600 }}>
                    {d.deliverableNumber}
                  </TableCell>
                  <TableCell>{d.title}</TableCell>
                  <TableCell>
                    <Chip
                      label={d.type}
                      size="small"
                      variant="outlined"
                      color={d.type === "CDRL" ? "primary" : "secondary"}
                    />
                  </TableCell>
                  <TableCell>
                    <Chip label={d.status} size="small" {...getStatusChipProps(d.status)} />
                  </TableCell>
                  <TableCell sx={d.status.startsWith("Overdue") ? { color: "error.main" } : undefined}>
                    {formatDate(d.dueDate)}
                  </TableCell>
                  <TableCell>{d.createdOn ? formatDate(d.createdOn) : "—"}</TableCell>
                  <TableCell>
                    <Tooltip title={assignedToEmail}>
                      <Box component="span">{assignedToDisplay}</Box>
                    </Tooltip>
                  </TableCell>
                  {includeProgramColumn && (
                    <TableCell>
                      <Typography variant="caption" sx={{ color: "text.secondary" }}>
                        {programMap[d.programId] ?? d.programId}
                      </Typography>
                    </TableCell>
                  )}
                </TableRow>
              );
            })}

            {filtered.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={7 + (includeProgramColumn ? 1 : 0)}
                  align="center"
                  sx={{ py: 4, color: "text.secondary" }}
                >
                  No records match the current filters.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>

      <Dialog
        open={Boolean(editingDeliverable)}
        onClose={() => {
          if (!isSavingEdit) setEditingDeliverable(null);
        }}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>Edit Deliverable Information</DialogTitle>
        <DialogContent sx={{ display: "flex", flexDirection: "column", gap: 2, pt: 1 }}>
          <TextField
            label="Title"
            value={editTitle}
            onChange={(event) => setEditTitle(event.target.value)}
            fullWidth
            required
          />
          <TextField
            label="Description"
            value={editDescription}
            onChange={(event) => setEditDescription(event.target.value)}
            fullWidth
            multiline
            minRows={3}
          />
          <TextField
            label="Due Date"
            type="date"
            value={editDueDate}
            onChange={(event) => setEditDueDate(event.target.value)}
            fullWidth
            required
            slotProps={{ inputLabel: { shrink: true } }}
          />
          <Autocomplete
            freeSolo
            options={assignedToOptions}
            inputValue={editAssignedToEmail}
            onInputChange={(_event, value) => setEditAssignedToEmail(value)}
            getOptionLabel={(option) =>
              typeof option === "string"
                ? option
                : option.displayName
                ? `${option.displayName} (${option.email})`
                : option.email
            }
            renderInput={(params) => (
              <TextField {...params} label="Assigned To Email" fullWidth />
            )}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditingDeliverable(null)} disabled={isSavingEdit}>
            Cancel
          </Button>
          <Button
            onClick={handleSaveEdit}
            variant="contained"
            disabled={!editTitle.trim() || !editDueDate || isSavingEdit}
          >
            {isSavingEdit ? "Saving..." : "Save Changes"}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
