"use client";

import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import FormControl from "@mui/material/FormControl";
import InputLabel from "@mui/material/InputLabel";
import MenuItem from "@mui/material/MenuItem";
import Select from "@mui/material/Select";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import FilterAltIcon from "@mui/icons-material/FilterAlt";
import type { AnalyticsOverview } from "@/lib/analytics";
import { DOCUMENT_ROLES } from "@/lib/models/document";

interface AnalyticsPageViewProps {
  initialOverview: AnalyticsOverview;
}

const PRESETS = [
  { value: "2026", label: "2026", startDate: "2026-01-01", endDate: "2026-12-31" },
  { value: "year", label: "Current year" },
  { value: "90", label: "Past 90 days" },
  { value: "60", label: "Past 2 months" },
  { value: "30", label: "Past 30 days" },
  { value: "custom", label: "Custom" },
];

function toInputDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function getPresetRange(preset: string) {
  const now = new Date();
  if (preset === "year") {
    const year = now.getFullYear();
    return { startDate: `${year}-01-01`, endDate: `${year}-12-31` };
  }
  const fixed = PRESETS.find((item) => item.value === preset && item.startDate);
  if (fixed?.startDate && fixed.endDate) return fixed;
  const days = Number(preset);
  if (Number.isFinite(days)) {
    const start = new Date(now);
    start.setDate(now.getDate() - days);
    return { startDate: toInputDate(start), endDate: toInputDate(now) };
  }
  return undefined;
}

function formatMonth(month: string) {
  const date = new Date(`${month}-01T00:00:00Z`);
  return date.toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

function buildQuery(values: Record<string, string>) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value) params.set(key, value);
  }
  return params.toString();
}

export default function AnalyticsPageView({ initialOverview }: AnalyticsPageViewProps) {
  const [overview, setOverview] = useState(initialOverview);
  const [preset, setPreset] = useState("2026");
  const [startDate, setStartDate] = useState(initialOverview.filters.startDate);
  const [endDate, setEndDate] = useState(initialOverview.filters.endDate);
  const [programId, setProgramId] = useState(initialOverview.filters.programId ?? "");
  const [user, setUser] = useState(initialOverview.filters.user ?? "");
  const [deliverableType, setDeliverableType] = useState(
    initialOverview.filters.deliverableType ?? ""
  );
  const [status, setStatus] = useState(initialOverview.filters.status ?? "");
  const [documentRole, setDocumentRole] = useState(
    initialOverview.filters.documentRole ?? ""
  );
  const [error, setError] = useState<string | null>(null);

  const query = useMemo(
    () =>
      buildQuery({
        startDate,
        endDate,
        programId,
        user,
        deliverableType,
        status,
        documentRole,
      }),
    [deliverableType, documentRole, endDate, programId, startDate, status, user]
  );

  useEffect(() => {
    let cancelled = false;

    fetch(`/api/analytics/overview?${query}`)
      .then(async (response) => {
        if (!response.ok) {
          const body = await response.json().catch(() => null);
          throw new Error(body?.error ?? "Failed to load analytics.");
        }
        return response.json();
      })
      .then((nextOverview: AnalyticsOverview) => {
        if (!cancelled) {
          setOverview(nextOverview);
          setError(null);
        }
      })
      .catch((requestError) => {
        if (!cancelled) {
          setError(
            requestError instanceof Error
              ? requestError.message
              : "Failed to load analytics."
          );
        }
      });

    return () => {
      cancelled = true;
    };
  }, [query]);

  function handlePresetChange(value: string) {
    setPreset(value);
    const range = getPresetRange(value);
    if (!range) return;
    setStartDate(range.startDate);
    setEndDate(range.endDate);
  }

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 2.5 }}>
      <Box>
        <Typography variant="h5">Analytics</Typography>
        <Typography variant="body2" sx={{ color: "text.secondary", mt: 0.25 }}>
          Reporting across documents, deliverables, programs, and user activity
        </Typography>
      </Box>

      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: {
            xs: "1fr",
            sm: "repeat(2, minmax(0, 1fr))",
            lg: "repeat(4, minmax(0, 1fr))",
          },
          gap: 1.5,
          alignItems: "center",
        }}
      >
        <FormControl size="small" fullWidth>
          <InputLabel id="analytics-preset-label">Date range</InputLabel>
          <Select
            labelId="analytics-preset-label"
            label="Date range"
            value={preset}
            onChange={(event) => handlePresetChange(event.target.value)}
          >
            {PRESETS.map((item) => (
              <MenuItem key={item.value} value={item.value}>
                {item.label}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <TextField
          size="small"
          label="Start"
          type="date"
          value={startDate}
          onChange={(event) => {
            setPreset("custom");
            setStartDate(event.target.value);
          }}
          InputLabelProps={{ shrink: true }}
        />
        <TextField
          size="small"
          label="End"
          type="date"
          value={endDate}
          onChange={(event) => {
            setPreset("custom");
            setEndDate(event.target.value);
          }}
          InputLabelProps={{ shrink: true }}
        />
        <FormControl size="small" fullWidth>
          <InputLabel id="analytics-program-label">Program</InputLabel>
          <Select
            labelId="analytics-program-label"
            label="Program"
            value={programId}
            onChange={(event) => setProgramId(event.target.value)}
          >
            <MenuItem value="">All programs</MenuItem>
            {overview.programs.map((program) => (
              <MenuItem key={program.id} value={program.id}>
                {program.programNumber} - {program.name}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <TextField
          size="small"
          label="User"
          value={user}
          onChange={(event) => setUser(event.target.value)}
          placeholder="john.doe@email.com"
        />
        <FormControl size="small" fullWidth>
          <InputLabel id="analytics-type-label">Deliverable type</InputLabel>
          <Select
            labelId="analytics-type-label"
            label="Deliverable type"
            value={deliverableType}
            onChange={(event) => setDeliverableType(event.target.value)}
          >
            <MenuItem value="">All types</MenuItem>
            {overview.deliverableTypes.map((type) => (
              <MenuItem key={type} value={type}>
                {type}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <TextField
          size="small"
          label="Status"
          value={status}
          onChange={(event) => setStatus(event.target.value)}
          placeholder="Complete"
        />
        <FormControl size="small" fullWidth>
          <InputLabel id="analytics-role-label">Document role</InputLabel>
          <Select
            labelId="analytics-role-label"
            label="Document role"
            value={documentRole}
            onChange={(event) => setDocumentRole(event.target.value)}
          >
            <MenuItem value="">All roles</MenuItem>
            {DOCUMENT_ROLES.map((role) => (
              <MenuItem key={role} value={role}>
                {role}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      </Box>

      {error && <Alert severity="error">{error}</Alert>}

      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: {
            xs: "repeat(2, minmax(0, 1fr))",
            md: "repeat(3, minmax(0, 1fr))",
            lg: "repeat(6, minmax(0, 1fr))",
          },
          gap: 1.5,
        }}
      >
        {overview.stats.map((stat) => (
          <Card key={stat.label} variant="outlined">
            <CardContent sx={{ p: 1.5, "&:last-child": { pb: 1.5 } }}>
              <Typography sx={{ fontWeight: 700, fontSize: "1.5rem", color: "primary.main" }}>
                {stat.value}
              </Typography>
              <Typography variant="caption" sx={{ color: "text.secondary", fontWeight: 700 }}>
                {stat.label}
              </Typography>
            </CardContent>
          </Card>
        ))}
      </Box>

      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", lg: "1fr 1fr" }, gap: 2 }}>
        <AnalyticsTable title="User Analytics" empty="No user activity found for these filters.">
          <TableHead>
            <TableRow>
              <TableCell>User</TableCell>
              <TableCell align="right">Documents</TableCell>
              <TableCell align="right">Projects</TableCell>
              <TableCell align="right">Assigned</TableCell>
              <TableCell align="right">Completed</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {overview.userAnalytics.slice(0, 10).map((row) => (
              <TableRow key={`${row.email}-${row.name}`}>
                <TableCell>{row.name || row.email}</TableCell>
                <TableCell align="right">{row.documentsSubmitted}</TableCell>
                <TableCell align="right">{row.projectsInvolved}</TableCell>
                <TableCell align="right">{row.assignedDeliverables}</TableCell>
                <TableCell align="right">{row.completedDeliverables}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </AnalyticsTable>

        <AnalyticsTable title="Program Analytics" empty="No program activity found for these filters.">
          <TableHead>
            <TableRow>
              <TableCell>Program</TableCell>
              <TableCell align="right">Documents</TableCell>
              <TableCell align="right">Created</TableCell>
              <TableCell align="right">Completed</TableCell>
              <TableCell align="right">Overdue</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {overview.programAnalytics.slice(0, 10).map((row) => (
              <TableRow key={row.id}>
                <TableCell>{row.programNumber}</TableCell>
                <TableCell align="right">{row.documentsSubmitted}</TableCell>
                <TableCell align="right">{row.deliverablesCreated}</TableCell>
                <TableCell align="right">{row.deliverablesCompleted}</TableCell>
                <TableCell align="right">{row.overdue}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </AnalyticsTable>
      </Box>

      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", lg: "1fr 1fr" }, gap: 2 }}>
        <AnalyticsTable title="Deliverable Types" empty="No deliverables found for these filters.">
          <TableHead>
            <TableRow>
              <TableCell>Type</TableCell>
              <TableCell align="right">Total</TableCell>
              <TableCell align="right">Completed</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {overview.deliverableTypeAnalytics.map((row) => (
              <TableRow key={row.type}>
                <TableCell>{row.type}</TableCell>
                <TableCell align="right">{row.total}</TableCell>
                <TableCell align="right">{row.completed}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </AnalyticsTable>

        <AnalyticsTable title="Submissions by Month" empty="No monthly submissions found.">
          <TableHead>
            <TableRow>
              <TableCell>Month</TableCell>
              <TableCell align="right">Documents</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {overview.monthlySubmissions.map((row) => (
              <TableRow key={row.month}>
                <TableCell>{formatMonth(row.month)}</TableCell>
                <TableCell align="right">{row.documentsSubmitted}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </AnalyticsTable>
      </Box>

      <Box sx={{ display: "flex", justifyContent: "flex-end" }}>
        <Button
          variant="outlined"
          startIcon={<FilterAltIcon />}
          onClick={() => {
            setProgramId("");
            setUser("");
            setDeliverableType("");
            setStatus("");
            setDocumentRole("");
            handlePresetChange("2026");
          }}
        >
          Reset Filters
        </Button>
      </Box>
    </Box>
  );
}

function AnalyticsTable({
  title,
  empty,
  children,
}: {
  title: string;
  empty: string;
  children: ReactNode;
}) {
  const tableBody = Array.isArray(children) ? children[1] : undefined;
  const hasRows =
    typeof tableBody === "object" &&
    tableBody !== null &&
    "props" in tableBody &&
    Array.isArray((tableBody as { props?: { children?: unknown[] } }).props?.children)
      ? Boolean((tableBody as { props: { children: unknown[] } }).props.children.length)
      : true;

  return (
    <Box sx={{ border: "1px solid", borderColor: "divider", borderRadius: 1, overflow: "hidden" }}>
      <Box sx={{ px: 2, py: 1.5, borderBottom: "1px solid", borderColor: "divider" }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
          {title}
        </Typography>
      </Box>
      {hasRows ? (
        <Table size="small">{children}</Table>
      ) : (
        <Typography variant="body2" sx={{ color: "text.secondary", p: 2 }}>
          {empty}
        </Typography>
      )}
    </Box>
  );
}
