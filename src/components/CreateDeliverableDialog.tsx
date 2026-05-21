"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Alert from "@mui/material/Alert";
import Autocomplete, { createFilterOptions } from "@mui/material/Autocomplete";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import FormControl from "@mui/material/FormControl";
import InputLabel from "@mui/material/InputLabel";
import MenuItem from "@mui/material/MenuItem";
import Select from "@mui/material/Select";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import AddIcon from "@mui/icons-material/Add";
import type { SelectChangeEvent } from "@mui/material/Select";
import type { DeliverableType } from "@/lib/models/deliverable";
import type { Program } from "@/lib/models/program";
import { useRole } from "@/lib/context/role-context";

interface CreateDeliverableDialogProps {
  programs: Program[];
  deliverableTypes: DeliverableType[];
  defaultProgramId?: string;
}

type TypeOption = DeliverableType & {
  inputValue?: string;
};

interface AssignedToOption {
  email: string;
  displayName?: string;
}

const filterTypeOptions = createFilterOptions<TypeOption>();

function normalizeTypeName(value: string) {
  return value.trim().toLowerCase();
}

export default function CreateDeliverableDialog({
  programs,
  deliverableTypes,
  defaultProgramId,
}: CreateDeliverableDialogProps) {
  const router = useRouter();
  const { canCreateDeliverableForProgram } = useRole();
  const creatablePrograms = useMemo(
    () => programs.filter((program) => canCreateDeliverableForProgram(program.id)),
    [canCreateDeliverableForProgram, programs]
  );
  const initialProgramId =
    defaultProgramId && creatablePrograms.some((program) => program.id === defaultProgramId)
      ? defaultProgramId
      : creatablePrograms[0]?.id ?? "";
  const [open, setOpen] = useState(false);
  const [programId, setProgramId] = useState(initialProgramId);
  const selectedProgram = creatablePrograms.find((program) => program.id === programId);
  const assignedToOptions = useMemo(() => {
    const options = new Map<string, AssignedToOption>();

    if (selectedProgram?.ownerUpn) {
      options.set(selectedProgram.ownerUpn, {
        email: selectedProgram.ownerUpn,
        displayName: selectedProgram.ownerName,
      });
    }

    for (const entry of selectedProgram?.access ?? []) {
      if (!entry.isActive || !entry.email) continue;
      options.set(entry.email, {
        email: entry.email,
        displayName: entry.displayName,
      });
    }

    return [...options.values()];
  }, [selectedProgram]);
  const [title, setTitle] = useState("");
  const [deliverableNumber, setDeliverableNumber] = useState("");
  const [typeOptions, setTypeOptions] = useState<TypeOption[]>(deliverableTypes);
  const [selectedType, setSelectedType] = useState<TypeOption | null>(
    deliverableTypes[0] ?? null
  );
  const [typeInput, setTypeInput] = useState(deliverableTypes[0]?.name ?? "");
  const [dueDate, setDueDate] = useState("");
  const [assignedToEmail, setAssignedToEmail] = useState("");
  const [directoryAssignedToOptions, setDirectoryAssignedToOptions] = useState<
    AssignedToOption[]
  >([]);
  const [description, setDescription] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!programId && initialProgramId) {
      setProgramId(initialProgramId);
    }
  }, [initialProgramId, programId]);

  useEffect(() => {
    if (!open) return;

    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      try {
        const params = new URLSearchParams();
        if (assignedToEmail.trim()) params.set("q", assignedToEmail.trim());
        const response = await fetch(`/api/users/program-collaborators?${params}`, {
          signal: controller.signal,
        });
        const json = (await response.json().catch(() => null)) as {
          users?: AssignedToOption[];
        } | null;

        if (!response.ok) {
          setDirectoryAssignedToOptions([]);
          return;
        }

        setDirectoryAssignedToOptions(json?.users ?? []);
      } catch {
        if (!controller.signal.aborted) setDirectoryAssignedToOptions([]);
      }
    }, 200);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [assignedToEmail, open]);

  const mergedAssignedToOptions = useMemo(() => {
    const options = new Map<string, AssignedToOption>();

    for (const option of assignedToOptions) {
      options.set(option.email.toLowerCase(), option);
    }

    for (const option of directoryAssignedToOptions) {
      const key = option.email.toLowerCase();
      const existing = options.get(key);
      options.set(key, {
        ...existing,
        ...option,
        displayName: option.displayName ?? existing?.displayName,
      });
    }

    return [...options.values()];
  }, [assignedToOptions, directoryAssignedToOptions]);

  const disabled =
    isSaving ||
    !programId ||
    !title.trim() ||
    !typeInput.trim() ||
    !dueDate;

  function resetForm() {
    setProgramId(initialProgramId);
    setTitle("");
    setDeliverableNumber("");
    setTypeOptions(deliverableTypes);
    setSelectedType(deliverableTypes[0] ?? null);
    setTypeInput(deliverableTypes[0]?.name ?? "");
    setDueDate("");
    setAssignedToEmail("");
    setDescription("");
    setMessage(null);
    setError(null);
  }

  async function resolveDeliverableTypeId() {
    const requestedName = typeInput.trim();
    const normalizedName = normalizeTypeName(requestedName);

    if (
      selectedType &&
      !selectedType.inputValue &&
      normalizeTypeName(selectedType.name) === normalizedName
    ) {
      return selectedType.id;
    }

    const existingType =
      typeOptions.find(
        (type) =>
          !type.inputValue &&
          (type.normalizedName === normalizedName ||
            normalizeTypeName(type.name) === normalizedName)
      ) ??
      deliverableTypes.find(
        (type) =>
          type.normalizedName === normalizedName ||
          normalizeTypeName(type.name) === normalizedName
      );

    if (existingType) {
      return existingType.id;
    }

    const response = await fetch("/api/deliverable-types", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: requestedName }),
    });

    const json = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(json?.error ?? "Failed to create deliverable type.");
    }

    const createdType = json?.deliverableType as DeliverableType | undefined;
    if (!createdType?.id) {
      throw new Error("Deliverable type was created without an ID.");
    }

    setTypeOptions((current) => [...current, createdType]);
    setSelectedType(createdType);
    setTypeInput(createdType.name);

    return createdType.id;
  }

  async function handleCreate() {
    setIsSaving(true);
    setError(null);
    setMessage(null);

    try {
      const typeId = await resolveDeliverableTypeId();
      const response = await fetch("/api/deliverables", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          programId,
          title,
          deliverableNumber,
          typeId,
          dueDate,
          assignedToEmail,
          description,
        }),
      });

      const json = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(json?.error ?? "Failed to create deliverable.");
      }

      setMessage(
        json?.requiresProgramOwnerApproval
          ? "Draft created. A program owner must approve it before submission."
          : "Deliverable created."
      );
      router.refresh();
      setTimeout(() => {
        setOpen(false);
        resetForm();
      }, 700);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Failed to create deliverable.");
    } finally {
      setIsSaving(false);
    }
  }

  if (creatablePrograms.length === 0) {
    return null;
  }

  return (
    <>
      <Button
        variant="contained"
        size="small"
        startIcon={<AddIcon />}
        onClick={() => {
          resetForm();
          setOpen(true);
        }}
      >
        Create Deliverable
      </Button>
      <Dialog
        open={open}
        onClose={() => {
          if (!isSaving) setOpen(false);
        }}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Create Deliverable</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2} sx={{ pt: 0.5 }}>
            {error && <Alert severity="error">{error}</Alert>}
            {message && <Alert severity="success">{message}</Alert>}
            <FormControl fullWidth required>
              <InputLabel id="deliverable-program-label">Program</InputLabel>
              <Select
                labelId="deliverable-program-label"
                value={programId}
                label="Program"
                onChange={(event: SelectChangeEvent) => setProgramId(event.target.value)}
              >
                {creatablePrograms.map((program) => (
                  <MenuItem key={program.id} value={program.id}>
                    {program.name}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <TextField
              label="Deliverable number"
              value={deliverableNumber}
              onChange={(event) => setDeliverableNumber(event.target.value)}
              fullWidth
              helperText="Leave blank to generate the next program number automatically."
            />
            <TextField
              label="Title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              fullWidth
              required
            />
            <Autocomplete
              freeSolo
              selectOnFocus
              handleHomeEndKeys
              options={typeOptions}
              value={selectedType}
              inputValue={typeInput}
              getOptionLabel={(option) => {
                if (typeof option === "string") return option;
                return option.inputValue ?? option.name;
              }}
              filterOptions={(options, params) => {
                const filtered = filterTypeOptions(options, params);
                const inputValue = params.inputValue.trim();
                const normalizedInput = normalizeTypeName(inputValue);
                const exists = options.some(
                  (option) => option.normalizedName === normalizedInput
                );

                if (inputValue && !exists) {
                  filtered.push({
                    id: inputValue,
                    name: `Add "${inputValue}"`,
                    normalizedName: normalizedInput,
                    isActive: true,
                    inputValue,
                  });
                }

                return filtered;
              }}
              onChange={(_, value) => {
                if (typeof value === "string") {
                  setSelectedType(null);
                  setTypeInput(value);
                  return;
                }

                if (value?.inputValue) {
                  setSelectedType(null);
                  setTypeInput(value.inputValue);
                  return;
                }

                setSelectedType(value);
                setTypeInput(value?.name ?? "");
              }}
              onInputChange={(_, value) => setTypeInput(value)}
              renderInput={(params) => (
                <TextField {...params} label="Type" required />
              )}
            />
            <TextField
              label="Due date"
              type="date"
              value={dueDate}
              onChange={(event) => setDueDate(event.target.value)}
              fullWidth
              required
              InputLabelProps={{ shrink: true }}
            />
            <Autocomplete
              freeSolo
              options={mergedAssignedToOptions}
              inputValue={assignedToEmail}
              getOptionLabel={(option) => {
                if (typeof option === "string") return option;
                return option.displayName || option.email;
              }}
              filterOptions={(options, params) => {
                const query = params.inputValue.trim().toLowerCase();
                if (!query) return options;

                return options.filter((option) =>
                  `${option.displayName ?? ""} ${option.email}`
                    .toLowerCase()
                    .includes(query)
                );
              }}
              onChange={(_, value) => {
                if (typeof value === "string") {
                  setAssignedToEmail(value);
                  return;
                }

                setAssignedToEmail(value?.email ?? "");
              }}
              onInputChange={(_, value, reason) => {
                if (reason === "input" || reason === "clear") {
                  setAssignedToEmail(value);
                }
              }}
              renderInput={(params) => (
                <TextField {...params} label="Assigned to" fullWidth />
              )}
              renderOption={({ key, ...props }, option) => (
                <li key={key} {...props}>
                  <Stack spacing={0.25}>
                    <Typography variant="body2">
                      {option.displayName || option.email}
                    </Typography>
                    {option.displayName && (
                      <Typography variant="caption" sx={{ color: "text.secondary" }}>
                        {option.email}
                      </Typography>
                    )}
                  </Stack>
                </li>
              )}
            />
            <TextField
              label="Description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              fullWidth
              multiline
              minRows={3}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)} disabled={isSaving}>
            Cancel
          </Button>
          <Button variant="contained" disabled={disabled} onClick={handleCreate}>
            {isSaving ? "Creating..." : "Create"}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
