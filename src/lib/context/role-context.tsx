'use client';

import {
  EFFECTIVE_ROLES,
  ROLE_LABELS,
  normalizeEmail,
  type EffectiveRole,
  type InternalRole,
} from '@/lib/auth/roles';
import type { Program, ProgramAccess } from '@/lib/models/program';
import { useSession } from 'next-auth/react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

export const ROLES = EFFECTIVE_ROLES;
export type Role = EffectiveRole;
export { ROLE_LABELS };

type ProgramAccessMap = Record<string, ProgramAccess[]>;

function getEffectiveRoles(
  email: string,
  internalRoles: InternalRole[],
  accessMap: ProgramAccessMap,
) {
  const roles = new Set<Role>(internalRoles);

  const hasProgramAccess = Object.values(accessMap).some((entries) =>
    entries.some((entry) => normalizeEmail(entry.email) === email),
  );

  if (hasProgramAccess) {
    roles.add('gov-reviewer');
  }

  return EFFECTIVE_ROLES.filter((role) => roles.has(role));
}

interface RoleContextValue {
  role: Role | null;
  roles: Role[];
  currentUser: {
    id: string;
    name: string;
    email: string;
    role: Role | null;
  } | null;
  isLoading: boolean;
  programs: Program[];
  getProgramById: (programId: string) => Program | undefined;
  getProgramAccessList: (programId: string) => ProgramAccess[];
  canViewProgram: (programId: string) => boolean;
  canCreateDeliverableForProgram: (programId: string) => boolean;
  canApproveDeliverableDraftForProgram: (programId: string) => boolean;
  canDeleteDeliverableForProgram: (programId: string, documentCount: number) => boolean;
  canDeleteDocumentsForProgram: (programId: string) => boolean;
  canUploadToProgram: (programId: string) => boolean;
  canManageProgramAccess: (programId: string) => boolean;
  canGrantProgramAccess: (programId: string, email: string) => boolean;
  canRevokeProgramAccess: (programId: string, email: string) => boolean;
  refreshPrograms: () => Promise<void>;
  hasAnyRole: (allowedRoles: readonly Role[]) => boolean;
}

const RoleContext = createContext<RoleContextValue>({
  role: null,
  roles: [],
  currentUser: null,
  isLoading: true,
  programs: [],
  getProgramById: () => undefined,
  getProgramAccessList: () => [],
  canViewProgram: () => false,
  canCreateDeliverableForProgram: () => false,
  canApproveDeliverableDraftForProgram: () => false,
  canDeleteDeliverableForProgram: () => false,
  canDeleteDocumentsForProgram: () => false,
  canUploadToProgram: () => false,
  canManageProgramAccess: () => false,
  canGrantProgramAccess: () => false,
  canRevokeProgramAccess: () => false,
  refreshPrograms: async () => {},
  hasAnyRole: () => false,
});

export function RoleProvider({ children }: { children: React.ReactNode }) {
  const { data: session, status } = useSession();
  const [programs, setPrograms] = useState<Program[]>([]);
  const [programAccessMap, setProgramAccessMap] = useState<ProgramAccessMap>(
    {},
  );
  const [isLoadingPrograms, setIsLoadingPrograms] = useState(true);

  const internalRoles = useMemo(
    () => session?.user.internalRoles ?? [],
    [session?.user.internalRoles],
  );
  const currentUserEmail = normalizeEmail(session?.user.email);
  const roles = useMemo(
    () => getEffectiveRoles(currentUserEmail, internalRoles, programAccessMap),
    [currentUserEmail, internalRoles, programAccessMap],
  );
  const role = roles[0] ?? null;

  const refreshPrograms = useCallback(async () => {
    if (!session?.user) {
      setPrograms([]);
      setProgramAccessMap({});
      setIsLoadingPrograms(false);
      return;
    }

    setIsLoadingPrograms(true);

    try {
      const response = await fetch('/api/programs');
      if (!response.ok) {
        throw new Error('Failed to load programs.');
      }
      const json = (await response.json()) as { programs: Program[] };
      setPrograms(json.programs);
      setProgramAccessMap(
        Object.fromEntries(
          json.programs.map((program) => [program.id, program.access]),
        ),
      );
    } catch {
      setPrograms([]);
      setProgramAccessMap({});
    } finally {
      setIsLoadingPrograms(false);
    }
  }, [session?.user]);

  useEffect(() => {
    if (status === 'loading') return;

    let cancelled = false;
    refreshPrograms().finally(() => {
      if (cancelled) return;
    });

    return () => {
      cancelled = true;
    };
  }, [refreshPrograms, status]);

  const mergedPrograms = useMemo(
    () =>
      programs.map((program) => ({
        ...program,
        access: programAccessMap[program.id] ?? program.access,
      })),
    [programs, programAccessMap],
  );

  const currentUser = session?.user
    ? {
        id: session.user.id,
        name: session.user.name ?? session.user.email ?? 'Signed-in user',
        email: session.user.email ?? '',
        role,
      }
    : null;

  const getProgramById = (programId: string) =>
    mergedPrograms.find((program) => program.id === programId);

  const getProgramAccessList = (programId: string) => {
    return programAccessMap[programId] ?? [];
  };

  const canViewProgram = (programId: string) => {
    if (internalRoles.includes('drg-admin')) return true;

    return (programAccessMap[programId] ?? []).some(
      (entry) =>
        entry.isActive && normalizeEmail(entry.email) === currentUserEmail,
    );
  };

  const canManageProgramAccess = (programId: string) => {
    if (internalRoles.includes('drg-admin')) return true;
    if (!internalRoles.includes('drg-program-owner')) return false;
    return (programAccessMap[programId] ?? []).some(
      (entry) =>
        entry.isActive &&
        entry.accessRole === 'Program Owner' &&
        normalizeEmail(entry.email) === currentUserEmail,
    );
  };

  const canUploadToProgram = (programId: string) => {
    const program = mergedPrograms.find((program) => program.id === programId);
    if (!program || program.status === 'Archived') return false;
    if (internalRoles.includes('drg-admin')) return true;

    return (programAccessMap[programId] ?? []).some((entry) => {
      const isCurrentUser = normalizeEmail(entry.email) === currentUserEmail;
      if (!entry.isActive || !isCurrentUser) return false;

      if (
        internalRoles.includes('drg-program-owner') ||
        internalRoles.includes('drg-staff')
      ) {
        return (
          entry.accessRole === 'DRG Staff' ||
          entry.accessRole === 'Program Owner'
        );
      }

      if (internalRoles.includes('external-reviewer')) {
        return entry.accessRole === 'External Reviewer';
      }

      return false;
    });
  };

  const canCreateDeliverableForProgram = (programId: string) => {
    const program = mergedPrograms.find((program) => program.id === programId);
    if (!program || program.status === 'Archived') return false;
    if (internalRoles.includes('drg-admin')) return true;

    return (programAccessMap[programId] ?? []).some((entry) => {
      const isCurrentUser = normalizeEmail(entry.email) === currentUserEmail;
      if (!entry.isActive || !isCurrentUser) return false;

      if (
        internalRoles.includes('drg-program-owner') ||
        internalRoles.includes('drg-staff')
      ) {
        return (
          entry.accessRole === 'DRG Staff' ||
          entry.accessRole === 'Program Owner'
        );
      }

      return false;
    });
  };

  const canApproveDeliverableDraftForProgram = (programId: string) => {
    const program = mergedPrograms.find((program) => program.id === programId);
    if (!program || program.status === 'Archived') return false;
    if (internalRoles.includes('drg-admin')) return true;
    if (!internalRoles.includes('drg-program-owner')) return false;

    return (programAccessMap[programId] ?? []).some(
      (entry) =>
        entry.isActive &&
        entry.accessRole === 'Program Owner' &&
        normalizeEmail(entry.email) === currentUserEmail,
    );
  };

  const canDeleteDocumentsForProgram = (programId: string) => {
    const program = mergedPrograms.find((program) => program.id === programId);
    if (!program || program.status === 'Archived') return false;
    if (internalRoles.includes('drg-admin')) return true;
    if (!internalRoles.includes('drg-program-owner')) return false;

    return (programAccessMap[programId] ?? []).some(
      (entry) =>
        entry.isActive &&
        entry.accessRole === 'Program Owner' &&
        normalizeEmail(entry.email) === currentUserEmail,
    );
  };

  const canDeleteDeliverableForProgram = (
    programId: string,
    documentCount: number,
  ) => {
    void documentCount;
    return canDeleteDocumentsForProgram(programId);
  };

  const canGrantProgramAccess = (programId: string, email: string) => {
    const normalizedEmail = normalizeEmail(email);

    if (!normalizedEmail || !canManageProgramAccess(programId)) return false;

    return true;
  };

  const canRevokeProgramAccess = (programId: string, email: string) => {
    const normalizedEmail = normalizeEmail(email);

    if (!normalizedEmail || !canManageProgramAccess(programId)) return false;
    if (normalizedEmail === currentUserEmail) return false;

    return (programAccessMap[programId] ?? []).some(
      (entry) => normalizeEmail(entry.email) === normalizedEmail,
    );
  };

  return (
    <RoleContext.Provider
      value={{
        role,
        roles,
        currentUser,
        isLoading: status === 'loading' || isLoadingPrograms,
        programs: mergedPrograms,
        getProgramById,
        getProgramAccessList,
        canViewProgram,
        canCreateDeliverableForProgram,
        canApproveDeliverableDraftForProgram,
        canDeleteDeliverableForProgram,
        canDeleteDocumentsForProgram,
        canUploadToProgram,
        canManageProgramAccess,
        canGrantProgramAccess,
        canRevokeProgramAccess,
        refreshPrograms,
        hasAnyRole: (allowedRoles) =>
          allowedRoles.some((allowedRole) => roles.includes(allowedRole)),
      }}
    >
      {children}
    </RoleContext.Provider>
  );
}

export function useRole() {
  return useContext(RoleContext);
}
