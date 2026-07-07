import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '@/lib/api';
import * as api from '@/lib/api';
import type { ProjectView } from '@/types/operations';
import type {
  CreateProjectInput,
  ProjectWorkerAssignmentView,
  AssignWorkerInput,
  UserRef,
} from '@/types/projects';

function toMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error && error.message.length > 0) return error.message;
  return fallback;
}

/* ==========================================================================
   Capa 3 — Proyectos por faena
   ========================================================================== */

/** Valor expuesto por {@link useFaenaProjects}. */
export interface UseFaenaProjectsResult {
  projects: ProjectView[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  create: (dto: CreateProjectInput) => Promise<ProjectView>;
}

/**
 * Hook de datos de los Proyectos de una faena (`GET /projects?faenaId=`). Se
 * recarga cuando cambia `faenaId`; con `faenaId` undefined no dispara la carga.
 */
export function useFaenaProjects(faenaId: string | undefined): UseFaenaProjectsResult {
  const [projects, setProjects] = useState<ProjectView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    if (!faenaId) {
      setProjects([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const list = await api.listProjects(faenaId);
      if (mountedRef.current) setProjects(list);
    } catch (err) {
      if (mountedRef.current) {
        setError(toMessage(err, 'No se pudieron cargar los proyectos.'));
      }
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [faenaId]);

  useEffect(() => {
    void load();
  }, [load]);

  const create = useCallback(
    async (dto: CreateProjectInput) => {
      const p = await api.createProject(dto);
      await load();
      return p;
    },
    [load],
  );

  return { projects, loading, error, refetch: load, create };
}

/* ==========================================================================
   Capa 3 — Detalle de un proyecto
   ========================================================================== */

/** Valor expuesto por {@link useProject}. */
export interface UseProjectResult {
  project: ProjectView | null;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

/** Hook de detalle de un proyecto (`GET /projects/:id`). */
export function useProject(projectId: string | undefined): UseProjectResult {
  const [project, setProject] = useState<ProjectView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    if (!projectId) {
      setProject(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const p = await api.getProject(projectId);
      if (mountedRef.current) setProject(p);
    } catch (err) {
      if (mountedRef.current) {
        setError(toMessage(err, 'No se pudo cargar el proyecto.'));
      }
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  return { project, loading, error, refetch: load };
}

/* ==========================================================================
   Capa 4 — Trabajadores asignados al proyecto (gate project:team:manage)
   ========================================================================== */

/** Valor expuesto por {@link useAssignments}. */
export interface UseAssignmentsResult {
  assignments: ProjectWorkerAssignmentView[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  create: (dto: AssignWorkerInput) => Promise<ProjectWorkerAssignmentView>;
  update: (
    assignmentId: string,
    dto: Partial<AssignWorkerInput>,
  ) => Promise<ProjectWorkerAssignmentView>;
  remove: (assignmentId: string) => Promise<void>;
}

/**
 * Hook de datos de las asignaciones de trabajadores de un proyecto
 * (`GET/POST/PATCH/DELETE /projects/:id/assignments`). Las mutaciones recargan
 * la lista; el gate `project:team:manage` lo resuelve el backend (403 si falta).
 */
export function useAssignments(projectId: string | undefined): UseAssignmentsResult {
  const [assignments, setAssignments] = useState<ProjectWorkerAssignmentView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    if (!projectId) {
      setAssignments([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const list = await api.listAssignments(projectId);
      if (mountedRef.current) setAssignments(list);
    } catch (err) {
      if (mountedRef.current) {
        setError(toMessage(err, 'No se pudieron cargar los trabajadores.'));
      }
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  const create = useCallback(
    async (dto: AssignWorkerInput) => {
      if (!projectId) throw new Error('No hay proyecto seleccionado.');
      const a = await api.createAssignment(projectId, dto);
      await load();
      return a;
    },
    [projectId, load],
  );

  const update = useCallback(
    async (assignmentId: string, dto: Partial<AssignWorkerInput>) => {
      if (!projectId) throw new Error('No hay proyecto seleccionado.');
      const a = await api.updateAssignment(projectId, assignmentId, dto);
      await load();
      return a;
    },
    [projectId, load],
  );

  const remove = useCallback(
    async (assignmentId: string) => {
      if (!projectId) throw new Error('No hay proyecto seleccionado.');
      await api.removeAssignment(projectId, assignmentId);
      await load();
    },
    [projectId, load],
  );

  return { assignments, loading, error, refetch: load, create, update, remove };
}

/* ==========================================================================
   Capa 3 — Administradores elegibles (selector del wizard de proyecto)
   ========================================================================== */

/** Valor expuesto por {@link useEligibleAdmins}. */
export interface UseEligibleAdminsResult {
  admins: UserRef[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

/** Hook de los usuarios elegibles como administrador de proyecto (`GET /projects/eligible-admins`). */
export function useEligibleAdmins(): UseEligibleAdminsResult {
  const [admins, setAdmins] = useState<UserRef[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await api.listEligibleAdmins();
      if (mountedRef.current) setAdmins(list);
    } catch (err) {
      if (mountedRef.current) {
        setError(toMessage(err, 'No se pudieron cargar los administradores.'));
      }
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return { admins, loading, error, refetch: load };
}
