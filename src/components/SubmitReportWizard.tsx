"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Card from "@mui/material/Card";
import CardActionArea from "@mui/material/CardActionArea";
import CardContent from "@mui/material/CardContent";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Divider from "@mui/material/Divider";
import Alert from "@mui/material/Alert";
import TextField from "@mui/material/TextField";
import InputAdornment from "@mui/material/InputAdornment";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import UploadFileIcon from "@mui/icons-material/UploadFile";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import SearchIcon from "@mui/icons-material/Search";
import BusinessCenterIcon from "@mui/icons-material/BusinessCenter";
import DescriptionIcon from "@mui/icons-material/Description";
import Link from "next/link";
import AccessRestrictedNotice from "@/components/AccessRestrictedNotice";
import { useRole } from "@/lib/context/role-context";
import type { Program } from "@/lib/models/program";
import type { Deliverable, DeliverableStatus } from "@/lib/models/deliverable";

const STEPS = ["Select Program", "Select Deliverable", "Attach Document", "Submitted"];
const PDF_REQUIRED_MESSAGE = "Only PDF files can be uploaded.";
const MAX_SUBMISSION_FILE_BYTES = 4 * 1024 * 1024;
const FILE_SIZE_LIMIT_MESSAGE =
  "This PDF is too large to upload through the dashboard. Please upload a PDF smaller than 4 MB.";
const SUBMISSION_TIMEOUT_MS = 120_000;
const SUBMISSION_TIMEOUT_MESSAGE =
  "Document submission timed out after 2 minutes. Please try again. If this keeps happening locally, verify SharePoint and network configuration.";

function ensurePdfFileName(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  return trimmed.toLowerCase().endsWith(".pdf") ? trimmed : `${trimmed}.pdf`;
}

const STATUS_CHIP_STYLE: Partial<Record<DeliverableStatus, object>> = {
  "In Review": { bgcolor: "#0078d4", color: "#fff" },
  Returned: { bgcolor: "#ed6c02", color: "#fff" },
  "Pending Acknowledgment": { bgcolor: "#6d4c41", color: "#fff" },
  Complete: { bgcolor: "#2e7d32", color: "#fff" },
  Submitted: { bgcolor: "#00695c", color: "#fff" },
  "Overdue - Waiting on Reviewer": { bgcolor: "#d32f2f", color: "#fff" },
  "Overdue - Waiting on DRG": { bgcolor: "#d32f2f", color: "#fff" },
};

// Fake ref, server would return a real one after persisting
function genSubmissionRef() {
  return `SUB-${new Date().getFullYear()}-${Math.floor(Math.random() * 900000 + 100000)}`;
}

function StepIndicator({ current }: { current: number }) {
  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 0, mb: 4 }}>
      {STEPS.map((label, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <Box key={label} sx={{ display: "flex", alignItems: "center", flex: i < STEPS.length - 1 ? 1 : "none" }}>
            <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 0.5 }}>
              <Box
                sx={{
                  width: 28,
                  height: 28,
                  borderRadius: "50%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  bgcolor: done ? "primary.main" : active ? "primary.main" : "action.disabledBackground",
                  color: done || active ? "#fff" : "text.disabled",
                  fontSize: "0.75rem",
                  fontWeight: 700,
                  flexShrink: 0,
                }}
              >
                {done ? "✓" : i + 1}
              </Box>
              <Typography
                variant="caption"
                sx={{
                  fontSize: "0.65rem",
                  fontWeight: active ? 700 : 400,
                  color: active ? "primary.main" : done ? "text.primary" : "text.disabled",
                  whiteSpace: "nowrap",
                }}
              >
                {label}
              </Typography>
            </Box>
            {i < STEPS.length - 1 && (
              <Box
                sx={{
                  flex: 1,
                  height: 2,
                  bgcolor: done ? "primary.main" : "action.disabledBackground",
                  mx: 0.75,
                  mb: 2.5,
                }}
              />
            )}
          </Box>
        );
      })}
    </Box>
  );
}

function ProgramStep({
  programs,
  deliverables,
  onSelect,
}: {
  programs: Program[];
  deliverables: Deliverable[];
  onSelect: (id: string) => void;
}) {
  const [searchQuery, setSearchQuery] = useState("");
  const normalizedSearchQuery = searchQuery.trim().toLowerCase();
  const filteredPrograms = useMemo(() => {
    if (!normalizedSearchQuery) return programs;

    return programs.filter((program) =>
      [
        program.name,
        program.programNumber,
        program.contractRef,
        program.ownerName ?? "",
        program.ownerUpn,
      ].some((value) => value.toLowerCase().includes(normalizedSearchQuery))
    );
  }, [normalizedSearchQuery, programs]);

  return (
    <Box>
      <Typography variant="h6" sx={{ fontWeight: 700, mb: 0.5 }}>
        Which program are you submitting for?
      </Typography>
      <Typography variant="body2" sx={{ color: "text.secondary", mb: 3 }}>
        Select the contract or program this deliverable belongs to.
      </Typography>
      <TextField
        value={searchQuery}
        onChange={(event) => setSearchQuery(event.target.value)}
        placeholder="Search programs"
        size="small"
        fullWidth
        sx={{ mb: 2 }}
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
      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "repeat(2, 1fr)" }, gap: 2 }}>
        {filteredPrograms.map((p) => {
          const progDeliverables = deliverables.filter((d) => d.programId === p.id);
          const pending = progDeliverables.filter(
            (d) => d.status !== "Draft" && d.status !== "Submitted" && d.status !== "Complete"
          ).length;
          return (
            <Card key={p.id} variant="outlined" sx={{ "&:hover": { boxShadow: 3 } }}>
              <CardActionArea onClick={() => onSelect(p.id)} sx={{ p: 0.5 }}>
                <CardContent>
                  <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                    {p.name}
                  </Typography>
                  <Typography
                    variant="caption"
                    sx={{ fontFamily: "monospace", color: "text.secondary", display: "block", mb: 1 }}
                  >
                    {p.contractRef}
                  </Typography>
                  <Typography variant="caption" sx={{ color: "text.secondary" }}>
                    {progDeliverables.length} deliverables
                    {pending > 0 && ` · ${pending} pending`}
                  </Typography>
                </CardContent>
              </CardActionArea>
            </Card>
          );
        })}
      </Box>
      {filteredPrograms.length === 0 && (
        <Typography variant="body2" sx={{ color: "text.secondary", textAlign: "center", py: 4 }}>
          No programs match the current search.
        </Typography>
      )}
    </Box>
  );
}

function DeliverableStep({
  program,
  deliverables,
  onSelect,
  onBack,
}: {
  program: Program;
  deliverables: Deliverable[];
  onSelect: (id: string) => void;
  onBack: () => void;
}) {
  const [searchQuery, setSearchQuery] = useState("");
  const submittable = deliverables.filter(
    (d) => d.status !== "Draft" && d.status !== "Submitted" && d.status !== "Complete"
  );
  const normalizedSearchQuery = searchQuery.trim().toLowerCase();
  const filteredDeliverables = useMemo(() => {
    if (!normalizedSearchQuery) return submittable;

    return submittable.filter((deliverable) =>
      [
        deliverable.deliverableNumber,
        deliverable.title,
        deliverable.type,
        deliverable.status,
        deliverable.assignedTo,
      ].some((value) => value.toLowerCase().includes(normalizedSearchQuery))
    );
  }, [normalizedSearchQuery, submittable]);

  return (
    <Box>
      <Button startIcon={<ArrowBackIcon />} size="small" sx={{ color: "text.secondary", mb: 2 }} onClick={onBack}>
        Back
      </Button>
      <Typography variant="h6" sx={{ fontWeight: 700, mb: 0.5 }}>
        Which deliverable are you submitting?
      </Typography>
      <Typography variant="body2" sx={{ color: "text.secondary", mb: 3 }}>
        {program.name} — <span style={{ fontFamily: "monospace", fontSize: "0.8rem" }}>{program.contractRef}</span>
      </Typography>
      <TextField
        value={searchQuery}
        onChange={(event) => setSearchQuery(event.target.value)}
        placeholder="Search deliverables"
        size="small"
        fullWidth
        sx={{ mb: 2 }}
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
      <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
        {filteredDeliverables.map((d) => (
          <Card
            key={d.id}
            variant="outlined"
            sx={{ "&:hover": { boxShadow: 2 } }}
          >
            <CardActionArea onClick={() => onSelect(d.id)}>
              <CardContent sx={{ display: "flex", alignItems: "center", gap: 2, py: 1.5, "&:last-child": { pb: 1.5 } }}>
                <Box sx={{ flex: 1 }}>
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 0.25 }}>
                    <Typography variant="caption" sx={{ fontFamily: "monospace", fontWeight: 700, color: "text.secondary" }}>
                      {d.deliverableNumber}
                    </Typography>
                    <Chip
                      label={d.type}
                      size="small"
                      variant="outlined"
                      color={d.type === "CDRL" ? "primary" : "secondary"}
                      sx={{ fontSize: "0.65rem", height: 18 }}
                    />
                  </Box>
                  <Typography variant="body2" sx={{ fontWeight: 500 }}>
                    {d.title}
                  </Typography>
                </Box>
                <Chip
                  label={d.status}
                  size="small"
                  sx={STATUS_CHIP_STYLE[d.status] ?? {}}
                />
              </CardContent>
            </CardActionArea>
          </Card>
        ))}
        {submittable.length === 0 && (
          <Typography variant="body2" sx={{ color: "text.secondary", textAlign: "center", py: 4 }}>
            All deliverables for this program already have submitted documents or are complete.
          </Typography>
        )}
        {submittable.length > 0 && filteredDeliverables.length === 0 && (
          <Typography variant="body2" sx={{ color: "text.secondary", textAlign: "center", py: 4 }}>
            No deliverables match the current search.
          </Typography>
        )}
      </Box>
    </Box>
  );
}

function UploadStep({
  deliverable,
  program,
  onSubmit,
  onBack,
  isSubmitting,
}: {
  deliverable: Deliverable;
  program: Program;
  onSubmit: (file: File, reviewDueDate: string, documentDescription: string) => void;
  onBack: () => void;
  isSubmitting: boolean;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [documentName, setDocumentName] = useState("");
  const [documentDescription, setDocumentDescription] = useState("");
  const [fileError, setFileError] = useState<string | null>(null);
  const [reviewDueDate, setReviewDueDate] = useState("");
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = (f: File) => {
    if (f.type !== "application/pdf" || !f.name.toLowerCase().endsWith(".pdf")) {
      setFile(null);
      setDocumentName("");
      setDocumentDescription("");
      setFileError(PDF_REQUIRED_MESSAGE);
      return;
    }

    if (f.size > MAX_SUBMISSION_FILE_BYTES) {
      setFile(null);
      setDocumentName("");
      setDocumentDescription("");
      setFileError(FILE_SIZE_LIMIT_MESSAGE);
      return;
    }

    setFileError(null);
    setFile(f);
    setDocumentName(f.name);
  };

  const submittedFileName = ensurePdfFileName(documentName);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const dropped = e.dataTransfer.files[0];
    if (dropped) handleFile(dropped);
  };

  return (
    <Box>
      <Button startIcon={<ArrowBackIcon />} size="small" sx={{ color: "text.secondary", mb: 2 }} onClick={onBack}>
        Previous Section
      </Button>
      <Typography variant="h6" sx={{ fontWeight: 700, mb: 0.5 }}>
        Attach document
      </Typography>
      <Box sx={{ display: "flex", gap: 1.5, flexWrap: "wrap", mb: 3 }}>
        <Box sx={{ display: "inline-flex", alignItems: "center", gap: 0.5 }}>
          <BusinessCenterIcon fontSize="small" sx={{ color: "text.secondary" }} />
          <Chip label={program.name} size="small" />
        </Box>
        <Box sx={{ display: "inline-flex", alignItems: "center", gap: 0.5 }}>
          <DescriptionIcon fontSize="small" sx={{ color: "text.secondary" }} />
          <Chip
            label={`${deliverable.deliverableNumber}: ${deliverable.title}`}
            size="small"
            variant="outlined"
            sx={{ fontFamily: "monospace" }}
          />
        </Box>
      </Box>

      {/* Drop zone */}
      <Box
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        sx={{
          border: "2px dashed",
          borderColor: dragging ? "primary.main" : file ? "success.main" : "divider",
          borderRadius: 2,
          p: 4,
          textAlign: "center",
          cursor: "pointer",
          bgcolor: dragging ? "action.hover" : file ? "rgba(46,125,50,0.04)" : "background.paper",
          transition: "all 0.15s",
          mb: 2,
        }}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".pdf,application/pdf"
          style={{ display: "none" }}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
        />
        {file ? (
          <Box>
            <CheckCircleIcon sx={{ fontSize: 36, color: "success.main", mb: 1 }} />
            <Typography variant="body1" sx={{ fontWeight: 600 }}>{file.name}</Typography>
            <Typography variant="caption" sx={{ color: "text.secondary" }}>
              {(file.size / 1024).toFixed(0)} KB · Click to change
            </Typography>
          </Box>
        ) : (
          <Box>
            <UploadFileIcon sx={{ fontSize: 36, color: "text.disabled", mb: 1 }} />
            <Typography variant="body1" sx={{ fontWeight: 500 }}>Click or drag to attach a file</Typography>
            <Typography variant="caption" sx={{ color: "text.secondary" }}>
              PDF
            </Typography>
          </Box>
        )}
      </Box>

      <Alert severity="info" sx={{ mb: 3 }}>
        Once submitted, this document becomes part of the permanent record. External reviewers will be
        notified and can view and download it, but cannot edit or delete it.
      </Alert>
      {fileError && <Alert severity="error" sx={{ mb: 3 }}>{fileError}</Alert>}

      {file && (
        <TextField
          label="PDF name"
          value={documentName}
          onChange={(event) => setDocumentName(event.target.value)}
          fullWidth
          helperText="This is the document name that will be saved with the submission."
          sx={{ mb: 3 }}
        />
      )}

      {file && (
        <TextField
          label="Document description"
          value={documentDescription}
          onChange={(event) => setDocumentDescription(event.target.value)}
          fullWidth
          multiline
          minRows={3}
          placeholder="Add any notes or context reviewers should see"
          sx={{ mb: 3 }}
        />
      )}

      <TextField
        label="Review due date"
        type="date"
        value={reviewDueDate}
        onChange={(event) => setReviewDueDate(event.target.value)}
        fullWidth
        sx={{ mb: 3 }}
        InputLabelProps={{ shrink: true }}
      />

      <Box sx={{ display: "flex", gap: 2 }}>
        <Button
          variant="contained"
          disabled={!file || !submittedFileName || isSubmitting}
          onClick={() => {
            if (!file || !submittedFileName) return;
            onSubmit(
              new File([file], submittedFileName, { type: file.type }),
              reviewDueDate,
              documentDescription
            );
          }}
        >
          {isSubmitting ? "Submitting..." : "Submit Document"}
        </Button>
        <Button component={Link} href="/documents" color="inherit">
          Cancel
        </Button>
      </Box>
    </Box>
  );
}

function ConfirmationStep({
  deliverable,
  program,
  file,
  submissionRef,
  submissionTime,
  warning,
  onSubmitAnother,
}: {
  deliverable: Deliverable;
  program: Program;
  file: File;
  submissionRef: string;
  submissionTime: string;
  warning?: string | null;
  onSubmitAnother: () => void;
}) {
  return (
    <Box>
      <Box sx={{ display: "flex", alignItems: "center", gap: 2, mb: 3 }}>
        <CheckCircleIcon sx={{ fontSize: 48, color: "success.main" }} />
        <Box>
          <Typography variant="h6" sx={{ fontWeight: 700 }}>
            Document submitted successfully
          </Typography>
          <Typography variant="body2" sx={{ color: "text.secondary" }}>
            This record is now permanent and time-stamped.
          </Typography>
        </Box>
      </Box>

      <Card variant="outlined" sx={{ mb: 3 }}>
        <CardContent sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
          {[
            { label: "Submission reference", value: submissionRef, mono: true },
            { label: "Submitted at", value: new Date(submissionTime).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" }) },
            { label: "Document", value: file.name },
            { label: "Deliverable", value: `${deliverable.deliverableNumber} - ${deliverable.title}` },
            { label: "Program", value: `${program.name} (${program.contractRef})` },
          ].map(({ label, value, mono }) => (
            <Box key={label} sx={{ display: "flex", gap: 2, alignItems: "baseline" }}>
              <Typography variant="caption" sx={{ color: "text.secondary", minWidth: 160, flexShrink: 0, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5, fontSize: "0.65rem" }}>
                {label}
              </Typography>
              <Typography variant="body2" sx={{ fontFamily: mono ? "monospace" : undefined, fontWeight: mono ? 700 : 400 }}>
                {value}
              </Typography>
            </Box>
          ))}
        </CardContent>
      </Card>

      <Alert severity={warning ? "warning" : "success"} sx={{ mb: 3 }}>
        {warning ??
          `External reviewers with access to ${program.name} have been notified. This submission is now stored as the system record; uploads and external reviewer download activity are logged.`}
      </Alert>

      <Divider sx={{ mb: 3 }} />
      <Box sx={{ display: "flex", gap: 2 }}>
        <Button component={Link} href="/documents" variant="contained">
          View in Documents
        </Button>
        <Button onClick={onSubmitAnother} variant="outlined">
          Submit Another
        </Button>
      </Box>
    </Box>
  );
}

interface SubmitReportWizardProps {
  deliverables: Deliverable[];
  initialProgramId?: string;
  initialDeliverableId?: string;
}

export default function SubmitReportWizard({
  deliverables,
  initialProgramId,
  initialDeliverableId,
}: SubmitReportWizardProps) {
  const { programs: allPrograms, canUploadToProgram } = useRole();
  const visiblePrograms = allPrograms.filter((program) => canUploadToProgram(program.id));
  const visibleProgramIds = new Set(visiblePrograms.map((program) => program.id));
  const visibleDeliverables = deliverables.filter((deliverable) =>
    visibleProgramIds.has(deliverable.programId) && deliverable.status !== "Draft"
  );

  // If we got here from a deliverable page (?programId=&deliverableId=), skip to upload
  const prefilled = !!(initialProgramId && initialDeliverableId);
  const [step, setStep] = useState(prefilled ? 2 : 0);
  const [programId, setProgramId] = useState<string | null>(initialProgramId ?? null);
  const [deliverableId, setDeliverableId] = useState<string | null>(initialDeliverableId ?? null);
  const [file, setFile] = useState<File | null>(null);
  const [submissionRef, setSubmissionRef] = useState("");
  const [submissionTime, setSubmissionTime] = useState("");
  const [submissionError, setSubmissionError] = useState<string | null>(null);
  const [submissionWarning, setSubmissionWarning] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submissionTimeoutRef = useRef<number | null>(null);

  const program = visiblePrograms.find((p) => p.id === programId) ?? null;
  const deliverable = visibleDeliverables.find((d) => d.id === deliverableId) ?? null;
  const programDeliverables = visibleDeliverables.filter((d) => d.programId === programId);

  useEffect(() => {
    return () => {
      if (submissionTimeoutRef.current !== null) {
        window.clearTimeout(submissionTimeoutRef.current);
      }
    };
  }, []);

  if (visiblePrograms.length === 0) {
    return (
      <AccessRestrictedNotice message="This account cannot submit documents because it is not assigned to any programs." />
    );
  }

  if ((programId && !program) || (deliverableId && !deliverable)) {
    return (
      <AccessRestrictedNotice message="This submission link points to a program or deliverable the current account cannot access." />
    );
  }

  const handleProgramSelect = (id: string) => {
    setProgramId(id);
    setDeliverableId(null);
    setStep(1);
  };

  const handleDeliverableSelect = (id: string) => {
    setDeliverableId(id);
    setStep(2);
  };

  const handleSubmit = async (f: File, reviewDueDate: string, documentDescription: string) => {
    if (!program || !deliverable) return;
    if (f.type !== "application/pdf" || !f.name.toLowerCase().endsWith(".pdf")) {
      setSubmissionError(PDF_REQUIRED_MESSAGE);
      return;
    }
    if (f.size > MAX_SUBMISSION_FILE_BYTES) {
      setSubmissionError(FILE_SIZE_LIMIT_MESSAGE);
      return;
    }

    setIsSubmitting(true);
    setSubmissionError(null);
    setSubmissionWarning(null);

    if (submissionTimeoutRef.current !== null) {
      window.clearTimeout(submissionTimeoutRef.current);
    }

    const controller = new AbortController();
    submissionTimeoutRef.current = window.setTimeout(() => {
      controller.abort();
    }, SUBMISSION_TIMEOUT_MS);

    try {
      const formData = new FormData();
      formData.set("programId", program.id);
      formData.set("deliverableId", deliverable.id);
      formData.set("file", f);
      if (reviewDueDate) formData.set("reviewDueDate", reviewDueDate);
      if (documentDescription.trim()) {
        formData.set("documentDescription", documentDescription.trim());
      }

      const res = await fetch("/api/documents/submit", {
        method: "POST",
        body: formData,
        signal: controller.signal,
      });

      const json = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(json?.error ?? "Failed to submit document.");
      }

      setFile(f);
      setSubmissionRef(json?.submissionRef ?? genSubmissionRef());
      setSubmissionWarning(
        typeof json?.warning === "string" ? json.warning : null
      );
      setSubmissionTime(new Date().toISOString());
      setStep(3);
    } catch (error) {
      setSubmissionError(
        error instanceof Error && error.name === "AbortError"
          ? SUBMISSION_TIMEOUT_MESSAGE
          : error instanceof Error
          ? error.message
          : "Failed to submit document."
      );
    } finally {
      if (submissionTimeoutRef.current !== null) {
        window.clearTimeout(submissionTimeoutRef.current);
        submissionTimeoutRef.current = null;
      }
      setIsSubmitting(false);
    }
  };

  const handleReset = () => {
    setProgramId(null);
    setDeliverableId(null);
    setFile(null);
    setSubmissionWarning(null);
    setStep(0); // always go to program picker on "submit another"
  };

  return (
    <Box>
      <StepIndicator current={step} />

      {step === 0 && (
        <ProgramStep programs={visiblePrograms} deliverables={visibleDeliverables} onSelect={handleProgramSelect} />
      )}
      {step === 1 && program && (
        <DeliverableStep
          program={program}
          deliverables={programDeliverables}
          onSelect={handleDeliverableSelect}
          onBack={() => setStep(0)}
        />
      )}
      {step === 2 && program && deliverable && (
        <>
          {submissionError && <Alert severity="error" sx={{ mb: 2 }}>{submissionError}</Alert>}
          <UploadStep
            deliverable={deliverable}
            program={program}
            onSubmit={handleSubmit}
            onBack={() => setStep(1)}
            isSubmitting={isSubmitting}
          />
        </>
      )}
      {step === 3 && program && deliverable && file && (
        <ConfirmationStep
          deliverable={deliverable}
          program={program}
          file={file}
          submissionRef={submissionRef}
          submissionTime={submissionTime}
          warning={submissionWarning}
          onSubmitAnother={handleReset}
        />
      )}
    </Box>
  );
}
