"use client";

import { useEffect, useState } from "react";
import Autocomplete from "@mui/material/Autocomplete";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";

export interface ProgramOwnerOption {
  id: string;
  email: string;
  displayName: string;
}

interface ProgramOwnerAutocompleteProps {
  value: ProgramOwnerOption | null;
  inputValue: string;
  disabled?: boolean;
  required?: boolean;
  onChange: (value: ProgramOwnerOption | null) => void;
  onInputChange: (value: string) => void;
  onError?: (message: string) => void;
}

export default function ProgramOwnerAutocomplete({
  value,
  inputValue,
  disabled,
  required,
  onChange,
  onInputChange,
  onError,
}: ProgramOwnerAutocompleteProps) {
  const [options, setOptions] = useState<ProgramOwnerOption[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (disabled) return;

    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setIsLoading(true);

      try {
        const params = new URLSearchParams();
        if (inputValue.trim()) params.set("q", inputValue.trim());
        const response = await fetch(`/api/users/program-owners?${params}`, {
          signal: controller.signal,
        });
        const json = (await response.json().catch(() => null)) as {
          users?: ProgramOwnerOption[];
          error?: string;
        } | null;

        if (!response.ok) {
          throw new Error(json?.error ?? "Failed to load program owners.");
        }

        setOptions(json?.users ?? []);
      } catch (error) {
        if (controller.signal.aborted) return;
        setOptions([]);
        onError?.(
          error instanceof Error ? error.message : "Failed to load program owners."
        );
      } finally {
        if (!controller.signal.aborted) setIsLoading(false);
      }
    }, 200);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [disabled, inputValue, onError]);

  return (
    <Autocomplete
      options={options}
      value={value}
      inputValue={inputValue}
      loading={isLoading}
      disabled={disabled}
      getOptionLabel={(option) => option.displayName || option.email}
      isOptionEqualToValue={(option, selectedValue) =>
        option.id === selectedValue.id
      }
      onChange={(_, selectedValue) => onChange(selectedValue)}
      onInputChange={(_, nextValue) => onInputChange(nextValue)}
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
      renderInput={(params) => (
        <TextField
          {...params}
          label="Assigned program owner"
          helperText="Select a user from the Entra program owner eligibility group."
          fullWidth
          required={required}
        />
      )}
    />
  );
}
