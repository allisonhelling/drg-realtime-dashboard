"use client";

import { useCallback, useEffect, useState } from "react";
import Alert from "@mui/material/Alert";
import Autocomplete from "@mui/material/Autocomplete";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Chip from "@mui/material/Chip";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogTitle from "@mui/material/DialogTitle";
import FormControl from "@mui/material/FormControl";
import InputLabel from "@mui/material/InputLabel";
import MenuItem from "@mui/material/MenuItem";
import Select from "@mui/material/Select";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { normalizeEmail } from "@/lib/auth/roles";
import type { Program } from "@/lib/models/program";
import type { ProgramAccess, ProgramAccessRole } from "@/lib/models/program";
import { useRole } from "@/lib/context/role-context";

interface ProgramCollaboratorOption {
  id: string;
  email: string;
  displayName: string;
  accessRole: ProgramAccess["accessRole"];
  eligibleAccessRoles?: ProgramAccessRole[];
}

const GRANTABLE_ACCESS_ROLES: ProgramAccessRole[] = [
  "Program Owner",
  "DRG Staff",
  "External Reviewer",
];

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function getDisplayName(
  email: string,
  options: ProgramCollaboratorOption[],
  fallback?: string
) {
  const match = options.find(
    (option) => normalizeEmail(option.email) === normalizeEmail(email)
  );
  return fallback || match?.displayName || email;
}

export default function ProgramAccessManager({ program }: { program: Program }) {
  const {
    currentUser,
    canManageProgramAccess,
    role,
    refreshPrograms,
  } = useRole();
  const [accessList, setAccessList] = useState<ProgramAccess[]>(program.access);
  const [selectedEmail, setSelectedEmail] = useState("");
  const [selectedCollaborator, setSelectedCollaborator] =
    useState<ProgramCollaboratorOption | null>(null);
  const [selectedAccessRole, setSelectedAccessRole] =
    useState<ProgramAccessRole>("DRG Staff");
  const [collaboratorInput, setCollaboratorInput] = useState("");
  const [collaboratorOptions, setCollaboratorOptions] = useState<
    ProgramCollaboratorOption[]
  >([]);
  const [isSavingAccess, setIsSavingAccess] = useState(false);
  const [isRevokingAccess, setIsRevokingAccess] = useState(false);
  const [isLoadingAccess, setIsLoadingAccess] = useState(false);
  const [isLoadingCollaborators, setIsLoadingCollaborators] = useState(false);
  const [accessError, setAccessError] = useState<string | null>(null);
  const [pendingRevokeEmail, setPendingRevokeEmail] = useState<string | null>(null);

  const mayManageAccess =
    canManageProgramAccess(program.id) ||
    role === "drg-admin" ||
    (role === "drg-program-owner" &&
      accessList.some(
        (entry) =>
          entry.isActive &&
          entry.accessRole === "Program Owner" &&
          normalizeEmail(entry.email) === normalizeEmail(currentUser?.email)
      ));
  const ownerDisplayName = getDisplayName(
    program.ownerUpn,
    collaboratorOptions,
    program.ownerName
  );

  const refreshAccessList = useCallback(async () => {
    setIsLoadingAccess(true);
    setAccessError(null);

    try {
      const res = await fetch(`/api/programs/${program.id}/access`);
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        throw new Error(json?.error ?? "Failed to load program access.");
      }

      const json = (await res.json()) as { access: ProgramAccess[] };
      setAccessList(json.access);
    } catch (error) {
      setAccessError(error instanceof Error ? error.message : "Failed to load program access.");
    } finally {
      setIsLoadingAccess(false);
    }
  }, [program.id]);

  useEffect(() => {
    void refreshAccessList();
  }, [refreshAccessList]);

  useEffect(() => {
    if (!mayManageAccess) return;

    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setIsLoadingCollaborators(true);

      try {
        const params = new URLSearchParams();
        if (collaboratorInput.trim()) params.set("q", collaboratorInput.trim());
        const response = await fetch(`/api/users/program-collaborators?${params}`, {
          signal: controller.signal,
        });
        const json = (await response.json().catch(() => null)) as {
          users?: ProgramCollaboratorOption[];
          error?: string;
        } | null;

        if (!response.ok) {
          throw new Error(json?.error ?? "Failed to load collaborators.");
        }

        setCollaboratorOptions(json?.users ?? []);
      } catch (error) {
        if (controller.signal.aborted) return;
        setCollaboratorOptions([]);
        setAccessError(
          error instanceof Error ? error.message : "Failed to load collaborators."
        );
      } finally {
        if (!controller.signal.aborted) setIsLoadingCollaborators(false);
      }
    }, 200);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [collaboratorInput, mayManageAccess]);

  async function handleGrantAccess() {
    const email = selectedEmail.trim().toLowerCase();
    if (!email) return;

    setIsSavingAccess(true);
    setAccessError(null);

    try {
      const res = await fetch(`/api/programs/${program.id}/access`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email, accessRole: selectedAccessRole }),
      });

      if (!res.ok) {
        const json = await res.json().catch(() => null);
        throw new Error(json?.error ?? "Failed to grant access.");
      }

      await Promise.all([refreshAccessList(), refreshPrograms()]);
      setSelectedEmail("");
      setSelectedCollaborator(null);
      setSelectedAccessRole("DRG Staff");
      setCollaboratorInput("");
    } catch (error) {
      setAccessError(error instanceof Error ? error.message : "Failed to grant access.");
    } finally {
      setIsSavingAccess(false);
    }
  }

  async function handleRevokeAccess() {
    if (!pendingRevokeEmail) return;

    setIsRevokingAccess(true);
    setAccessError(null);

    try {
      const res = await fetch(`/api/programs/${program.id}/access`, {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email: pendingRevokeEmail }),
      });

      if (!res.ok) {
        const json = await res.json().catch(() => null);
        throw new Error(json?.error ?? "Failed to revoke access.");
      }

      await Promise.all([refreshAccessList(), refreshPrograms()]);
      setPendingRevokeEmail(null);
    } catch (error) {
      setAccessError(error instanceof Error ? error.message : "Failed to revoke access.");
    } finally {
      setIsRevokingAccess(false);
    }
  }

  return (
    <Card variant="outlined" sx={{ mx: { md: -2 } }}>
      <CardContent sx={{ p: 2.5 }}>
        <Stack direction="row" spacing={1} sx={{ alignItems: "center", mb: 1 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
            Program Access
          </Typography>
          <Chip label={`${accessList.length} account${accessList.length === 1 ? "" : "s"}`} size="small" />
          {isLoadingAccess && <Chip label="Refreshing" size="small" variant="outlined" />}
        </Stack>

        <Typography variant="body2" sx={{ color: "text.secondary", mb: 2 }}>
          Review and manage who can access this program.
        </Typography>

        <Alert severity="info" sx={{ mb: 2 }}>
          Assigned program owner:{" "}
          {program.ownerUpn ? (
            <Tooltip title={program.ownerUpn}>
              <Box component="span">{ownerDisplayName}</Box>
            </Tooltip>
          ) : (
            "Unassigned"
          )}
        </Alert>

        {mayManageAccess ? (
          <Box
            sx={{
              display: "flex",
              flexWrap: "wrap",
              gap: 1.5,
              alignItems: "center",
              mb: 2,
            }}
          >
            <Autocomplete
              size="small"
              options={collaboratorOptions}
              value={selectedCollaborator}
              inputValue={collaboratorInput}
              loading={isLoadingCollaborators}
              getOptionLabel={(option) =>
                option.displayName
                  ? `${option.displayName} (${option.email})`
                  : option.email
              }
              isOptionEqualToValue={(option, selectedValue) =>
                option.id === selectedValue.id
              }
              onChange={(_, selectedValue) => {
                setSelectedCollaborator(selectedValue);
                setSelectedEmail(selectedValue?.email ?? "");
                setSelectedAccessRole(selectedValue?.accessRole ?? "DRG Staff");
              }}
              onInputChange={(_, nextValue) => {
                setCollaboratorInput(nextValue);
                if (!nextValue.trim()) {
                  setSelectedCollaborator(null);
                  setSelectedEmail("");
                  setSelectedAccessRole("DRG Staff");
                }
              }}
              renderOption={(props, option) => (
                <Box component="li" {...props} sx={{ gap: 1.5 }}>
                  <Box sx={{ minWidth: 0, flex: 1 }}>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      {option.displayName}
                    </Typography>
                    <Typography variant="caption" sx={{ color: "text.secondary" }}>
                      {option.email}
                    </Typography>
                  </Box>
                  <Chip label={option.accessRole} size="small" variant="outlined" />
                </Box>
              )}
              renderInput={(params) => (
                <TextField
                  {...params}
                  label="Invite collaborator or reviewer"
                  placeholder="Search by name or email"
                />
              )}
              sx={{ minWidth: 320, maxWidth: "100%", flex: 1 }}
            />
            <FormControl size="small" sx={{ minWidth: 180 }}>
              <InputLabel id="program-access-role-label">Access role</InputLabel>
              <Select
                labelId="program-access-role-label"
                label="Access role"
                value={selectedAccessRole}
                disabled={!selectedCollaborator}
                onChange={(event) =>
                  setSelectedAccessRole(event.target.value as ProgramAccessRole)
                }
              >
                {GRANTABLE_ACCESS_ROLES.filter((role) =>
                  selectedCollaborator
                    ? selectedCollaborator.eligibleAccessRoles?.includes(role) ??
                      selectedCollaborator.accessRole === role
                    : true
                ).map((role) => (
                  <MenuItem key={role} value={role}>
                    {role}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <Button
              variant="contained"
              size="small"
              disabled={!mayManageAccess || !normalizeEmail(selectedEmail) || isSavingAccess}
              onClick={handleGrantAccess}
            >
              {isSavingAccess ? "Sending Invite..." : "Grant Access"}
            </Button>
          </Box>
        ) : (
          <Alert severity="info" sx={{ mb: 2 }}>
            Only DRG admins or the assigned program owner can manage this access list.
          </Alert>
        )}

        {accessError && <Alert severity="error" sx={{ mb: 2 }}>{accessError}</Alert>}

        <TableContainer>
          <Table size="small" sx={{ minWidth: 760 }}>
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontWeight: 700, width: { xs: 220, md: 300 } }}>Name</TableCell>
                <TableCell sx={{ fontWeight: 700, minWidth: 240 }}>Email</TableCell>
                <TableCell sx={{ fontWeight: 700, minWidth: 150 }}>Role</TableCell>
                <TableCell sx={{ fontWeight: 700, minWidth: 180 }}>Granted On</TableCell>
                {mayManageAccess && <TableCell sx={{ fontWeight: 700, width: 120 }}>Actions</TableCell>}
              </TableRow>
            </TableHead>
            <TableBody>
              {accessList.map((entry) => {
                const mayRevoke =
                  mayManageAccess &&
                  entry.isActive &&
                  normalizeEmail(entry.email) !== normalizeEmail(currentUser?.email);
                const displayName = getDisplayName(
                  entry.email,
                  collaboratorOptions,
                  entry.displayName
                );
                return (
                  <TableRow key={entry.email} hover>
                    <TableCell sx={{ fontWeight: 600, minWidth: { xs: 220, md: 300 } }}>
                      <Tooltip title={entry.email}>
                        <Box component="span">{displayName}</Box>
                      </Tooltip>
                      {normalizeEmail(entry.email) === normalizeEmail(currentUser?.email) && (
                        <Typography component="span" variant="caption" sx={{ color: "text.secondary", ml: 0.75 }}>
                          (You)
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell>{entry.email}</TableCell>
                    <TableCell>
                      <Chip
                        label={entry.isActive ? entry.accessRole : "Inactive"}
                        size="small"
                        variant="outlined"
                        color={entry.isActive ? "default" : "warning"}
                      />
                    </TableCell>
                    <TableCell>{formatDateTime(entry.grantedAt)}</TableCell>
                    {mayManageAccess && (
                      <TableCell>
                        <Button
                          color="error"
                          size="small"
                          disabled={!mayRevoke}
                          onClick={() => setPendingRevokeEmail(entry.email)}
                        >
                          Revoke
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>

        <Dialog
          open={Boolean(pendingRevokeEmail)}
          onClose={() => setPendingRevokeEmail(null)}
        >
          <DialogTitle>Revoke program access?</DialogTitle>
          <DialogContent>
            <DialogContentText>
              Are you sure you would like to revoke access
              {pendingRevokeEmail ? ` for ${pendingRevokeEmail}` : ""}?
            </DialogContentText>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setPendingRevokeEmail(null)}>Cancel</Button>
            <Button
              color="error"
              variant="contained"
              disabled={isRevokingAccess}
              onClick={handleRevokeAccess}
            >
              {isRevokingAccess ? "Revoking..." : "Revoke Access"}
            </Button>
          </DialogActions>
        </Dialog>
      </CardContent>
    </Card>
  );
}
