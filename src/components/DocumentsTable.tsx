"use client";

import { useMemo, useState, Fragment } from "react";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Paper from "@mui/material/Paper";
import Chip from "@mui/material/Chip";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Alert from "@mui/material/Alert";
import IconButton from "@mui/material/IconButton";
import Collapse from "@mui/material/Collapse";
import Typography from "@mui/material/Typography";
import FormControl from "@mui/material/FormControl";
import FormControlLabel from "@mui/material/FormControlLabel";
import InputLabel from "@mui/material/InputLabel";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import Tooltip from "@mui/material/Tooltip";
import TextField from "@mui/material/TextField";
import InputAdornment from "@mui/material/InputAdornment";
import Switch from "@mui/material/Switch";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import DownloadIcon from "@mui/icons-material/Download";
import DeleteIcon from "@mui/icons-material/Delete";
import VisibilityIcon from "@mui/icons-material/Visibility";
import UploadFileIcon from "@mui/icons-material/UploadFile";
import SearchIcon from "@mui/icons-material/Search";
import MuiLink from "@mui/material/Link";
import NextLink from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { SelectChangeEvent } from "@mui/material/Select";
import type {
  DeliverableDocument,
  DocumentAccessAction,
  DocumentAccessLog,
  FileType,
} from "@/lib/models/document";
import { DOCUMENT_STATUSES, FILE_TYPES } from "@/lib/models/document";
import type { Program } from "@/lib/models/program";
import { useRole } from "@/lib/context/role-context";

const FILE_TYPE_COLORS: Record<FileType, string> = {
  Word: "#2b579a",
  PDF: "#d32f2f",
  Excel: "#217346",
  PowerPoint: "#d24726",
};

const ACTION_LABELS: Record<DocumentAccessAction, string> = {
  View: "Viewed",
  Download: "Downloaded",
  Upload: "Uploaded",
  Delete: "Deleted",
  Acknowledge: "Acknowledged",
};

function formatFileSize(sizeKb: number): string {
  return sizeKb >= 1000 ? `${(sizeKb / 1000).toFixed(1)} MB` : `${sizeKb} KB`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString();
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function getUploadDisplay(
  document: DeliverableDocument,
  logs: DocumentAccessLog[],
  programs: Program[]
) {
  const uploadLog = logs.find((event) => event.action === "Upload");
  const program = programs.find((entry) => entry.id === document.programId);
  const programDisplayName =
    program?.access.find(
      (entry) =>
        entry.email.toLowerCase() === document.uploadedByEmail.toLowerCase()
    )?.displayName ??
    (program?.ownerUpn.toLowerCase() === document.uploadedByEmail.toLowerCase()
      ? program.ownerName
      : undefined);
  const uploadActorName =
    uploadLog?.actorName && !uploadLog.actorName.includes("@")
      ? uploadLog.actorName
      : undefined;
  const documentDisplayName = document.uploadedBy.includes("@")
    ? undefined
    : document.uploadedBy;

  return {
    name:
      uploadActorName ||
      programDisplayName ||
      documentDisplayName ||
      document.uploadedByEmail ||
      document.uploadedBy,
    email: document.uploadedByEmail || uploadLog?.actorEmail || document.uploadedBy,
  };
}

function AccessLogRow({ logs, colSpan }: { logs: DocumentAccessLog[]; colSpan: number }) {
  if (logs.length === 0) {
    return (
      <TableRow>
        <TableCell colSpan={colSpan} sx={{ py: 1.5, pl: 6, bgcolor: "action.hover" }}>
          <Typography variant="caption" sx={{ color: "text.secondary" }}>
            No access activity recorded yet.
          </Typography>
        </TableCell>
      </TableRow>
    );
  }

  return (
    <TableRow sx={{ bgcolor: "action.hover" }}>
      <TableCell colSpan={colSpan} sx={{ pt: 1, pb: 1.5, pl: 6 }}>
        <Typography variant="caption" sx={{ fontWeight: 700, color: "text.secondary", textTransform: "uppercase", letterSpacing: 0.8, display: "block", mb: 0.75 }}>
          Access Log
        </Typography>
        <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
          {logs.map((event) => (
            <Box key={event.id} sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
              <Chip
                label={ACTION_LABELS[event.action]}
                size="small"
                variant="outlined"
                color={event.action === "Download" ? "primary" : "default"}
                sx={{ fontSize: "0.65rem", height: 20, minWidth: 80 }}
              />
              <Typography variant="caption" sx={{ fontWeight: 600 }}>
                <Tooltip title={event.actorEmail}>
                  <Box component="span">{event.actorName || event.actorEmail}</Box>
                </Tooltip>
              </Typography>
              <Typography variant="caption" sx={{ color: "text.secondary" }}>
                {formatDateTime(event.occurredOn)}
              </Typography>
            </Box>
          ))}
        </Box>
      </TableCell>
    </TableRow>
  );
}

interface DocumentsTableProps {
  documents: DeliverableDocument[];
  deliverableMap: Record<string, string>;
  programs: Program[];
  accessLogsByDocumentId?: Record<string, DocumentAccessLog[]>;
  detailSource?: "documents";
  showUploadAction?: boolean;
  showSearch?: boolean;
  showArchivedToggle?: boolean;
}

export default function DocumentsTable({
  documents,
  deliverableMap,
  programs,
  accessLogsByDocumentId = {},
  detailSource,
  showUploadAction = true,
  showSearch = false,
  showArchivedToggle = false,
}: DocumentsTableProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { role, canUploadToProgram, canDeleteDocumentsForProgram } = useRole();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [programFilter, setProgramFilter] = useState<string>("All");
  const [statusFilter, setStatusFilter] = useState<string>("All");
  const [typeFilter, setTypeFilter] = useState<string>("All");
  const [searchQuery, setSearchQuery] = useState("");
  const [includeArchivedPrograms, setIncludeArchivedPrograms] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const availablePrograms = useMemo(
    () =>
      includeArchivedPrograms || !showArchivedToggle
        ? programs
        : programs.filter((program) => program.status !== "Archived"),
    [includeArchivedPrograms, programs, showArchivedToggle]
  );
  const availableProgramIds = useMemo(
    () => new Set(availablePrograms.map((program) => program.id)),
    [availablePrograms]
  );
  const showProgramFilter = availablePrograms.length > 1;
  const hasArchivedPrograms = programs.some((program) => program.status === "Archived");
  const canUpload = programs.some((program) => canUploadToProgram(program.id));
  const programMap = useMemo(
    () => Object.fromEntries(programs.map((program) => [program.id, program.name])),
    [programs]
  );
  const availableDocuments = useMemo(
    () => documents.filter((document) => availableProgramIds.has(document.programId)),
    [availableProgramIds, documents]
  );
  const programCounts = useMemo(
    () =>
      availableDocuments.reduce<Record<string, number>>((counts, document) => {
        counts[document.programId] = (counts[document.programId] ?? 0) + 1;
        return counts;
      }, {}),
    [availableDocuments]
  );
  const statusCounts = useMemo(
    () =>
      availableDocuments.reduce<Record<string, number>>((counts, document) => {
        counts[document.status] = (counts[document.status] ?? 0) + 1;
        return counts;
      }, {}),
    [availableDocuments]
  );
  const typeCounts = useMemo(
    () =>
      availableDocuments.reduce<Record<string, number>>((counts, document) => {
        counts[document.fileType] = (counts[document.fileType] ?? 0) + 1;
        return counts;
      }, {}),
    [availableDocuments]
  );
  const canSeeAccessLog =
    role === "drg-admin" || role === "drg-program-owner" || role === "drg-staff";

  const effectiveProgramFilter =
    programFilter !== "All" && availableProgramIds.has(programFilter)
      ? programFilter
      : "All";
  const normalizedSearchQuery = searchQuery.trim().toLowerCase();
  const filtered = documents.filter((document) => {
    if (!availableProgramIds.has(document.programId)) return false;
    if (effectiveProgramFilter !== "All" && document.programId !== effectiveProgramFilter) {
      return false;
    }
    if (statusFilter !== "All" && document.status !== statusFilter) return false;
    if (typeFilter !== "All" && document.fileType !== typeFilter) return false;

    if (!normalizedSearchQuery) return true;

    const associatedRecord = [
      document.deliverableId,
      deliverableMap[document.deliverableId] ?? "",
      programMap[document.programId] ?? "",
    ].join(" ");

    return [document.fileName, document.fileType, associatedRecord].some((value) =>
      value.toLowerCase().includes(normalizedSearchQuery)
    );
  });
  const showDeleteActions = filtered.some((document) =>
    canDeleteDocumentsForProgram(document.programId)
  );
  const recordLabel = filtered.length === 1 ? "record" : "records";

  // Has to match real column count or the access log row breaks
  const colSpan = 8 + (canSeeAccessLog ? 1 : 0) + (showDeleteActions ? 1 : 0);

  const toggleExpand = (id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  };

  async function handleDelete(document: DeliverableDocument) {
    if (!window.confirm(`Delete ${document.fileName}? This cannot be undone.`)) {
      return;
    }

    setDeletingId(document.id);
    setActionError(null);

    try {
      const response = await fetch(`/api/documents/${document.id}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        const json = await response.json().catch(() => null);
        throw new Error(json?.error ?? "Failed to delete document.");
      }

      router.refresh();
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "Failed to delete document."
      );
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <Box>
      {actionError && <Alert severity="error" sx={{ mb: 2 }}>{actionError}</Alert>}

      {/* Filter controls */}
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 2, mb: 2, flexWrap: "wrap" }}>
        <Box sx={{ display: "flex", gap: 2, flexWrap: "wrap", alignItems: "center" }}>
          {showProgramFilter && (
            <FormControl size="small" sx={{ minWidth: 180 }}>
              <InputLabel id="doc-program-filter-label">Program</InputLabel>
              <Select
                labelId="doc-program-filter-label"
                value={effectiveProgramFilter}
                label="Program"
                onChange={(e: SelectChangeEvent) => setProgramFilter(e.target.value)}
              >
                <MenuItem value="All">All Programs ({availableDocuments.length})</MenuItem>
                {availablePrograms.map((p) => (
                  <MenuItem key={p.id} value={p.id}>
                    {p.name} ({programCounts[p.id] ?? 0})
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          )}

          <FormControl size="small" sx={{ minWidth: 160 }}>
            <InputLabel id="doc-status-filter-label">Status</InputLabel>
            <Select
              labelId="doc-status-filter-label"
              value={statusFilter}
              label="Status"
              onChange={(e: SelectChangeEvent) => setStatusFilter(e.target.value)}
            >
              <MenuItem value="All">All Statuses ({availableDocuments.length})</MenuItem>
              {DOCUMENT_STATUSES.map((status) => (
                <MenuItem key={status} value={status}>
                  {status} ({statusCounts[status] ?? 0})
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          <FormControl size="small" sx={{ minWidth: 130 }}>
            <InputLabel id="doc-type-filter-label">Type</InputLabel>
            <Select
              labelId="doc-type-filter-label"
              value={typeFilter}
              label="Type"
              onChange={(e: SelectChangeEvent) => setTypeFilter(e.target.value)}
            >
              <MenuItem value="All">All Types ({availableDocuments.length})</MenuItem>
              {FILE_TYPES.map((type) => (
                <MenuItem key={type} value={type}>
                  {type} ({typeCounts[type] ?? 0})
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          <Typography variant="body2" sx={{ color: "text.secondary", alignSelf: "center" }}>
            Displaying {filtered.length} {recordLabel}
          </Typography>

          {showArchivedToggle && (
            <FormControlLabel
              control={
                <Switch
                  checked={includeArchivedPrograms}
                  onChange={(event) => setIncludeArchivedPrograms(event.target.checked)}
                  disabled={!hasArchivedPrograms}
                  size="small"
                />
              }
              label="Include archived programs"
              sx={{
                color: "text.secondary",
                "& .MuiFormControlLabel-label": { fontSize: "0.875rem" },
              }}
            />
          )}
        </Box>

        <Box sx={{ display: "flex", gap: 2, alignItems: "center", ml: "auto", flexWrap: "wrap" }}>
          {showSearch && (
            <TextField
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search documents"
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
          {showUploadAction && canUpload && (
            <Tooltip title="Upload a PDF deliverable document">
              <Button
                component={NextLink}
                href={`/submit?returnTo=${encodeURIComponent(pathname)}&returnLabel=Documents`}
                variant="contained"
                size="small"
                startIcon={<UploadFileIcon />}
              >
                Upload Document
              </Button>
            </Tooltip>
          )}
          {role === "gov-reviewer" && (
            <Typography variant="caption" sx={{ color: "text.secondary" }}>
              Read-only access — download only
            </Typography>
          )}
        </Box>
      </Box>

      {/* Table */}
      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              {canSeeAccessLog && <TableCell sx={{ width: 40 }} />}
              <TableCell sx={{ fontWeight: 700 }}>File Name</TableCell>
              <TableCell sx={{ fontWeight: 700 }}>Type</TableCell>
              <TableCell sx={{ fontWeight: 700 }}>Associated Deliverable</TableCell>
              <TableCell sx={{ fontWeight: 700 }}>Associated Program</TableCell>
              <TableCell sx={{ fontWeight: 700 }}>Uploaded By</TableCell>
              <TableCell sx={{ fontWeight: 700 }}>Upload Date</TableCell>
              <TableCell sx={{ fontWeight: 700 }}>Status</TableCell>
              <TableCell sx={{ fontWeight: 700 }}>Actions</TableCell>
              {showDeleteActions && <TableCell sx={{ width: 48 }} />}
            </TableRow>
          </TableHead>

          <TableBody>
            {filtered.map((doc) => {
              const isExpanded = expandedId === doc.id;
              const logs = accessLogsByDocumentId[doc.id] ?? [];
              const accessCount = logs.length;
              const canDelete = canDeleteDocumentsForProgram(doc.programId);
              const uploadedBy = getUploadDisplay(doc, logs, programs);

              return (
                <Fragment key={doc.id}>
                  <TableRow hover selected={isExpanded}>
                    {/* Expand toggle (staff/admin only) */}
                    {canSeeAccessLog && (
                      <TableCell padding="none" sx={{ pl: 1 }}>
                        <Tooltip title={isExpanded ? "Hide access log" : `Access log (${accessCount})`}>
                          <IconButton size="small" onClick={() => toggleExpand(doc.id)}>
                            {isExpanded ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
                          </IconButton>
                        </Tooltip>
                      </TableCell>
                    )}

                    <TableCell>
                      <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                        <MuiLink
                          component={NextLink}
                          href={detailSource ? `/documents/${doc.id}?from=${detailSource}` : `/documents/${doc.id}`}
                          underline="hover"
                          sx={{ color: "text.primary", fontWeight: 500 }}
                        >
                          {doc.fileName}
                        </MuiLink>
                        {canSeeAccessLog && accessCount > 0 && (
                          <Chip
                            icon={<VisibilityIcon sx={{ fontSize: "0.75rem !important" }} />}
                            label={accessCount}
                            size="small"
                            variant="outlined"
                            sx={{ fontSize: "0.65rem", height: 18, cursor: "pointer" }}
                            onClick={() => toggleExpand(doc.id)}
                          />
                        )}
                      </Box>
                    </TableCell>

                    <TableCell>
                      <Chip
                        label={doc.fileType}
                        size="small"
                        sx={{ bgcolor: FILE_TYPE_COLORS[doc.fileType], color: "#fff" }}
                      />
                    </TableCell>

                    <TableCell>
                      {deliverableMap[doc.deliverableId] ?? doc.deliverableId}
                    </TableCell>

                    <TableCell>
                      {programMap[doc.programId] ?? doc.programId}
                    </TableCell>

                    <TableCell>
                      <Tooltip title={uploadedBy.email}>
                        <Box component="span">{uploadedBy.name}</Box>
                      </Tooltip>
                    </TableCell>
                    <TableCell>{formatDate(doc.uploadedAt)}</TableCell>

                    <TableCell>
                      <Chip label={doc.status} size="small" variant="outlined" />
                    </TableCell>

                    <TableCell>
                      <Box sx={{ display: "flex", gap: 0.5 }}>
                        <Tooltip title="Download">
                          <IconButton
                            component={NextLink}
                            href={`/api/documents/${doc.id}/download`}
                            size="small"
                          >
                            <DownloadIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                        <Typography variant="caption" sx={{ color: "text.secondary", alignSelf: "center" }}>
                          {formatFileSize(doc.sizeKb)}
                        </Typography>
                      </Box>
                    </TableCell>

                    {showDeleteActions && (
                      <TableCell>
                        {canDelete && (
                          <Tooltip title="Delete document">
                            <span>
                              <IconButton
                                size="small"
                                color="error"
                                disabled={deletingId === doc.id}
                                onClick={() => handleDelete(doc)}
                              >
                                <DeleteIcon fontSize="small" />
                              </IconButton>
                            </span>
                          </Tooltip>
                        )}
                      </TableCell>
                    )}
                  </TableRow>

                  {/* Access log expansion */}
                  {canSeeAccessLog && (
                    <TableRow>
                      <TableCell colSpan={colSpan} sx={{ p: 0, border: 0 }}>
                        <Collapse in={isExpanded} timeout="auto" unmountOnExit>
                          <Table size="small">
                            <TableBody>
                              <AccessLogRow logs={logs} colSpan={colSpan} />
                            </TableBody>
                          </Table>
                        </Collapse>
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              );
            })}

            {filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={colSpan} align="center" sx={{ py: 4, color: "text.secondary" }}>
                  No documents found.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  );
}
