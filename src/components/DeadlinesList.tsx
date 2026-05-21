"use client";

import { useMemo } from "react";
import NextLink from "next/link";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Chip from "@mui/material/Chip";
import Stack from "@mui/material/Stack";
import Tooltip from "@mui/material/Tooltip";
import type { Deliverable, DeliverableStatus } from "@/lib/models/deliverable";
import type { Program } from "@/lib/models/program";
import { normalizeEmail } from "@/lib/auth/roles";

const STATUS_CHIP_STYLE: Partial<Record<DeliverableStatus, object>> = {
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
  if (status === "Not Submitted") {
    return { color: "default" as const };
  }
  return { sx: STATUS_CHIP_STYLE[status] };
}

/** Strip time portion — returns midnight-local date for comparison. */
function toDateOnly(iso: string): Date {
  const d = new Date(iso);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Format a date as e.g. "Wed, Feb 18" */
function formatDueDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function getAssignedToEmail(deliverable: Deliverable) {
  return deliverable.assignedToEmail || deliverable.assignedTo;
}

function getAssignedToDisplay(deliverable: Deliverable, program: Program | undefined) {
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

interface DeliverableGroup {
  key: string;
  label: string;
  items: Deliverable[];
  isOverdue: boolean;
}

function groupDeliverables(deliverables: Deliverable[]): DeliverableGroup[] {
  const today = new Date();
  const todayOnly = new Date(today.getFullYear(), today.getMonth(), today.getDate());

  const dayOfWeek = todayOnly.getDay();
  const daysUntilSunday = dayOfWeek === 0 ? 0 : 7 - dayOfWeek;
  const endOfThisWeek = new Date(todayOnly);
  endOfThisWeek.setDate(todayOnly.getDate() + daysUntilSunday);

  const startOfNextWeek = new Date(endOfThisWeek);
  startOfNextWeek.setDate(endOfThisWeek.getDate() + 1);

  const endOfNextWeek = new Date(startOfNextWeek);
  endOfNextWeek.setDate(startOfNextWeek.getDate() + 6);

  const endOfMonth = new Date(todayOnly.getFullYear(), todayOnly.getMonth() + 1, 0);

  const overdue: Deliverable[] = [];
  const thisWeek: Deliverable[] = [];
  const nextWeek: Deliverable[] = [];
  const thisMonth: Deliverable[] = [];
  const later: Deliverable[] = [];

  for (const d of deliverables) {
    const due = toDateOnly(d.dueDate);

    if (due < todayOnly) {
      overdue.push(d);
    } else if (due <= endOfThisWeek) {
      thisWeek.push(d);
    } else if (due <= endOfNextWeek) {
      nextWeek.push(d);
    } else if (due <= endOfMonth) {
      thisMonth.push(d);
    } else {
      later.push(d);
    }
  }

  const sortByDue = (a: Deliverable, b: Deliverable) =>
    new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();

  overdue.sort(sortByDue);
  thisWeek.sort(sortByDue);
  nextWeek.sort(sortByDue);
  thisMonth.sort(sortByDue);
  later.sort(sortByDue);

  const groups: DeliverableGroup[] = [
    { key: "overdue", label: "Overdue", items: overdue, isOverdue: true },
    { key: "this-week", label: "This Week", items: thisWeek, isOverdue: false },
    { key: "next-week", label: "Next Week", items: nextWeek, isOverdue: false },
    { key: "this-month", label: "This Month", items: thisMonth, isOverdue: false },
    { key: "later", label: "Later", items: later, isOverdue: false },
  ];

  return groups.filter((g) => g.items.length > 0);
}

function DeliverableCard({
  deliverable,
  programName,
  program,
}: {
  deliverable: Deliverable;
  programName: string;
  program: Program | undefined;
}) {
  const assignedToEmail = getAssignedToEmail(deliverable);
  const assignedToDisplay = getAssignedToDisplay(deliverable, program);

  return (
    <Card
      variant="outlined"
      component={NextLink}
      href={`/records/${deliverable.id}?from=records`}
      sx={{
        color: "inherit",
        cursor: "pointer",
        display: "block",
        textDecoration: "none",
        "&:hover": {
          borderColor: "primary.main",
          boxShadow: 1,
        },
      }}
    >
      <CardContent
        sx={{
          display: "flex",
          flexDirection: "column",
          gap: 0.75,
          p: 2,
          "&:last-child": { pb: 2 },
        }}
      >
        {/* Row 1: Deliverable number + Title */}
        <Box sx={{ display: "flex", alignItems: "baseline", flexWrap: "wrap" }}>
          <Typography
            variant="subtitle1"
            sx={{
              color: "text.primary",
              fontWeight: 700,
            }}
          >
            Deliverable {deliverable.deliverableNumber}:
          </Typography>
          <Typography variant="subtitle1" sx={{ color: "secondary.main", fontWeight: 600, ml: 0.5 }}>
            {deliverable.title}
          </Typography>
        </Box>

        {/* Row 2: Type chip, Status chip, Due date, Assigned to */}
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 1.5,
            flexWrap: "wrap",
            mt: 0.25,
          }}
        >
          <Chip
            label={deliverable.type}
            size="small"
            variant="outlined"
            color={deliverable.type === "CDRL" ? "primary" : "secondary"}
          />
          <Chip
            label={deliverable.status}
            size="small"
            {...getStatusChipProps(deliverable.status)}
          />
          <Typography
            variant="body2"
            sx={{
              color: deliverable.status.startsWith("Overdue") ? "error.main" : "text.secondary",
              fontWeight: deliverable.status.startsWith("Overdue") ? 600 : 400,
            }}
          >
            Due: {formatDueDate(deliverable.dueDate)}
          </Typography>
          <Typography
            variant="body2"
            sx={{ color: "text.secondary" }}
          >
            Program: {programName}
          </Typography>
          <Typography
            variant="body2"
            sx={{ color: "text.secondary", ml: "auto" }}
          >
            <Tooltip title={assignedToEmail}>
              <Box component="span">{assignedToDisplay}</Box>
            </Tooltip>
          </Typography>
        </Box>
      </CardContent>
    </Card>
  );
}

interface DeadlinesListProps {
  deliverables: Deliverable[];
  programs: Program[];
}

export default function DeadlinesList({ deliverables, programs }: DeadlinesListProps) {
  // Exclude completed items — the calendar is an action surface, not a history view
  const actionable = deliverables.filter(
    (d) => d.status !== "Draft" && d.status !== "Submitted" && d.status !== "Complete"
  );
  const groups = useMemo(() => groupDeliverables(actionable), [actionable]);
  const programNameById = useMemo(
    () => Object.fromEntries(programs.map((program) => [program.id, program.name])),
    [programs]
  );
  const programsById = useMemo(
    () => new Map(programs.map((program) => [program.id, program])),
    [programs]
  );

  if (groups.length === 0) {
    return (
      <Box sx={{ py: 6, textAlign: "center" }}>
        <Typography variant="body1" sx={{ color: "text.secondary" }}>
          No upcoming deadlines.
        </Typography>
      </Box>
    );
  }

  return (
    <Stack spacing={4}>
      {groups.map((group) => (
        <Box
          key={group.key}
          sx={{
            borderLeft: 4,
            borderColor: group.isOverdue ? "#d32f2f" : "divider",
            pl: 2,
            ...(group.isOverdue && {
              bgcolor: "rgba(211, 47, 47, 0.04)",
              borderRadius: 1,
              py: 1.5,
              pr: 1,
            }),
          }}
        >
          {/* Section header */}
          <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, mb: 2 }}>
            <Typography
              variant="h6"
              sx={{
                fontWeight: 700,
                color: group.isOverdue ? "#d32f2f" : "text.primary",
              }}
            >
              {group.label}
            </Typography>
            <Chip
              label={group.items.length}
              size="small"
              sx={{
                fontWeight: 700,
                minWidth: 28,
                bgcolor: group.isOverdue ? "#d32f2f" : "primary.main",
                color: "#fff",
              }}
            />
          </Box>

          {/* Deliverable cards */}
          <Stack spacing={1.5}>
            {group.items.map((d) => (
              <DeliverableCard
                key={d.id}
                deliverable={d}
                programName={programNameById[d.programId] ?? d.programId}
                program={programsById.get(d.programId)}
              />
            ))}
          </Stack>
        </Box>
      ))}
    </Stack>
  );
}
