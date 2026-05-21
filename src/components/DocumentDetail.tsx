"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Chip from "@mui/material/Chip";
import Button from "@mui/material/Button";
import Alert from "@mui/material/Alert";
import Divider from "@mui/material/Divider";
import Tooltip from "@mui/material/Tooltip";
import DownloadIcon from "@mui/icons-material/Download";
import LockIcon from "@mui/icons-material/Lock";
import VisibilityIcon from "@mui/icons-material/Visibility";
import FileDownloadIcon from "@mui/icons-material/FileDownload";
import UploadFileIcon from "@mui/icons-material/UploadFile";
import BusinessCenterIcon from "@mui/icons-material/BusinessCenter";
import DescriptionIcon from "@mui/icons-material/Description";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import type {
  DeliverableDocument,
  DocumentAccessAction,
  DocumentAccessLog,
  FileType,
} from "@/lib/models/document";
import type { Program } from "@/lib/models/program";
import { useRole } from "@/lib/context/role-context";

const FILE_TYPE_COLORS: Record<FileType, string> = {
  Word: "#2b579a",
  PDF: "#d32f2f",
  Excel: "#217346",
  PowerPoint: "#d24726",
};

const ACTION_ICONS: Record<DocumentAccessAction, React.ReactNode> = {
  View: <VisibilityIcon sx={{ fontSize: "0.9rem" }} />,
  Download: <FileDownloadIcon sx={{ fontSize: "0.9rem" }} />,
  Upload: <UploadFileIcon sx={{ fontSize: "0.9rem" }} />,
  Delete: <VisibilityIcon sx={{ fontSize: "0.9rem" }} />,
  Acknowledge: <VisibilityIcon sx={{ fontSize: "0.9rem" }} />,
};

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatFileSize(sizeKb: number) {
  return sizeKb >= 1000 ? `${(sizeKb / 1000).toFixed(1)} MB` : `${sizeKb} KB`;
}

function AccessTimeline({ logs }: { logs: DocumentAccessLog[] }) {
  return (
    <Box>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 2 }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
          Access Log
        </Typography>
        <Chip label={logs.length} size="small" variant="outlined" sx={{ fontSize: "0.7rem", height: 20 }} />
      </Box>

      {logs.length === 0 && (
        <Typography variant="body2" sx={{ color: "text.secondary" }}>
          No access activity recorded yet.
        </Typography>
      )}

      <Box sx={{ position: "relative" }}>
        {/* Vertical line */}
        {logs.length > 1 && (
          <Box
            sx={{
              position: "absolute",
              left: 11,
              top: 24,
              bottom: 12,
              width: 2,
              bgcolor: "divider",
            }}
          />
        )}

        <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {logs.map((event) => (
            <Box key={event.id} sx={{ display: "flex", alignItems: "flex-start", gap: 2 }}>
              {/* Timeline dot */}
              <Box
                sx={{
                  width: 24,
                  height: 24,
                  borderRadius: "50%",
                  border: "2px solid",
                  borderColor: event.action === "Upload" ? "primary.main" : event.action === "Download" ? "success.main" : "divider",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: event.action === "Upload" || event.action === "Download" ? "#fff" : "text.secondary",
                  flexShrink: 0,
                  zIndex: 1,
                  bgcolor: event.action === "Upload" ? "primary.main" : event.action === "Download" ? "success.main" : "background.paper",
                }}
              >
                {ACTION_ICONS[event.action]}
              </Box>

              {/* Event content */}
              <Box sx={{ flex: 1, pb: 0.5 }}>
                <Box sx={{ display: "flex", alignItems: "baseline", gap: 1, flexWrap: "wrap" }}>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    <Tooltip title={event.actorEmail}>
                      <Box component="span">{event.actorName || event.actorEmail}</Box>
                    </Tooltip>
                  </Typography>
                  <Chip
                    label={event.action}
                    size="small"
                    variant="outlined"
                    color={
                      event.action === "Upload" ? "primary"
                      : event.action === "Download" ? "success"
                      : "default"
                    }
                    sx={{ fontSize: "0.65rem", height: 18 }}
                  />
                  {event.source && (
                    <Chip
                      label={event.source}
                      size="small"
                      variant="outlined"
                      sx={{ fontSize: "0.65rem", height: 18 }}
                    />
                  )}
                </Box>
                <Typography variant="caption" sx={{ color: "text.secondary" }}>
                  {formatDateTime(event.occurredOn)}
                </Typography>
              </Box>
            </Box>
          ))}
        </Box>
      </Box>
    </Box>
  );
}

interface DocumentDetailProps {
  doc: DeliverableDocument;
  deliverableLabel: string;
  program: Program | undefined;
  accessLogs?: DocumentAccessLog[];
}

export default function DocumentDetail({
  doc,
  deliverableLabel,
  program,
  accessLogs = [],
}: DocumentDetailProps) {
  const router = useRouter();
  const { role, canDeleteDocumentsForProgram } = useRole();
  const [isDeleting, setIsDeleting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const canSeeAccessLog =
    role === "drg-admin" || role === "drg-program-owner" || role === "drg-staff";
  const canDelete = canDeleteDocumentsForProgram(doc.programId);
  const uploadLog = accessLogs.find((event) => event.action === "Upload");
  const uploadedBy =
    uploadLog?.actorName && !uploadLog.actorName.includes("@")
      ? uploadLog.actorName
      : doc.uploadedBy || doc.uploadedByEmail;
  const uploadedByEmail = doc.uploadedByEmail || uploadLog?.actorEmail || doc.uploadedBy;

  async function handleDelete() {
    if (!window.confirm(`Delete ${doc.fileName}? This cannot be undone.`)) {
      return;
    }

    setIsDeleting(true);
    setActionError(null);

    try {
      const response = await fetch(`/api/documents/${doc.id}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        const json = await response.json().catch(() => null);
        throw new Error(json?.error ?? "Failed to delete document.");
      }

      router.push(`/records/${doc.deliverableId}`);
      router.refresh();
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "Failed to delete document."
      );
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
      {actionError && <Alert severity="error">{actionError}</Alert>}

      {/* Document header */}
      <Card variant="outlined">
        <CardContent sx={{ p: 2.5 }}>
          <Box sx={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: 2, mb: 2 }}>
            <Box>
              <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, mb: 0.5 }}>
                <Chip
                  label={doc.fileType}
                  size="small"
                  sx={{ bgcolor: FILE_TYPE_COLORS[doc.fileType], color: "#fff", fontWeight: 700 }}
                />
                <Typography variant="h6" sx={{ fontWeight: 700 }}>
                  {doc.fileName}
                </Typography>
              </Box>
              <Typography variant="body2" sx={{ color: "text.secondary" }}>
                {formatFileSize(doc.sizeKb)}
                {" · "}
                Uploaded by{" "}
                <Tooltip title={uploadedByEmail}>
                  <Box component="strong">{uploadedBy}</Box>
                </Tooltip>
                {" · "}
                {formatDateTime(doc.uploadedAt)}
              </Typography>
            </Box>
            <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
              {canDelete && (
                <Tooltip title="Delete document">
                  <Button
                    variant="outlined"
                    color="error"
                    startIcon={<DeleteOutlineIcon />}
                    size="small"
                    onClick={handleDelete}
                    disabled={isDeleting}
                  >
                    {isDeleting ? "Deleting..." : "Delete"}
                  </Button>
                </Tooltip>
              )}
              <Tooltip title="Download">
                <Button
                  component="a"
                  href={`/api/documents/${doc.id}/download`}
                  variant="contained"
                  startIcon={<DownloadIcon />}
                  size="small"
                >
                  Download
                </Button>
              </Tooltip>
            </Box>
          </Box>

          {/* Metadata row */}
          <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1.5 }}>
            <Box sx={{ display: "flex", gap: 0.5, alignItems: "center" }}>
              <DescriptionIcon fontSize="small" sx={{ color: "text.secondary" }} />
              <Chip label={deliverableLabel} size="small" variant="outlined" sx={{ fontSize: "0.72rem" }} />
            </Box>
            {program && (
              <Box sx={{ display: "flex", gap: 0.5, alignItems: "center" }}>
                <BusinessCenterIcon fontSize="small" sx={{ color: "text.secondary" }} />
                <Chip label={program.name} size="small" variant="outlined" sx={{ fontSize: "0.72rem" }} />
              </Box>
            )}
            <Chip label={doc.status} size="small" variant="outlined" />
          </Box>
        </CardContent>
      </Card>

      {/* Immutability notice */}
      <Alert
        icon={<LockIcon fontSize="inherit" />}
        severity="info"
        sx={{ "& .MuiAlert-message": { fontSize: "0.8rem" } }}
      >
        <strong>Permanent record.</strong> This document was submitted on {formatDateTime(doc.uploadedAt)} and cannot be
        modified or deleted by external users.
        {role === "external-reviewer" && " Your access to this document has been recorded."}
      </Alert>

      <Divider />

      {/* Access log — staff/admin only */}
      {canSeeAccessLog ? (
        <AccessTimeline logs={accessLogs} />
      ) : (
        <Box sx={{ py: 2 }}>
          <Typography variant="body2" sx={{ color: "text.secondary" }}>
            Access log is visible to DRG staff and administrators only.
          </Typography>
        </Box>
      )}
    </Box>
  );
}
