import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '@/lib/api';
import * as api from '@/lib/api';
import type { CreateServiceByTypeInput } from '@gmt-platform/contracts';
import type {
  ProjectView,
  ServiceView,
  TaskView,
  ProjectDocumentView,
  TaskStatus,
  CreateTaskInput,
  UpdateTaskInput,
  CreateProjectDocumentInput,
} from '@/types/operations';

function toMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error && error.message.length > 0) return error.message;
  return fallback;
}

/* ==========================================================================
   USE PROJECTS HOOK
   ========================================================================== */

export interface UseProjectsResult {
  projects: ProjectView[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  create: (dto: { code: string; name: string; departmentId: string; clientId: string }) => Promise<ProjectView>;
  createSrv: (projectId: string, dto: CreateServiceByTypeInput) => Promise<ServiceView>;
  updateKpis: (projectId: string, kpis: Record<string, unknown>) => Promise<ProjectView>;
}

export function useProjects(): UseProjectsResult {
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
    setLoading(true);
    setError(null);
    try {
      const list = await api.listProjects();
      if (mountedRef.current) setProjects(list);
    } catch (err) {
      if (mountedRef.current) {
        setError(toMessage(err, 'No se pudieron cargar los proyectos.'));
      }
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const create = useCallback(
    async (dto: { code: string; name: string; departmentId: string; clientId: string }) => {
      const p = await api.createProject(dto);
      await load();
      return p;
    },
    [load],
  );

  const createSrv = useCallback(
    async (projectId: string, dto: CreateServiceByTypeInput) => {
      const s = await api.createService(projectId, dto);
      await load();
      return s;
    },
    [load],
  );

  const updateKpis = useCallback(
    async (projectId: string, kpis: Record<string, unknown>) => {
      const p = await api.updateProjectKpis(projectId, kpis);
      await load();
      return p;
    },
    [load],
  );

  return {
    projects,
    loading,
    error,
    refetch: load,
    create,
    createSrv,
    updateKpis,
  };
}

/* ==========================================================================
   USE TASKS HOOK
   ========================================================================== */

export interface UseTasksResult {
  tasks: TaskView[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  create: (dto: CreateTaskInput) => Promise<TaskView>;
  update: (
    id: string,
    dto: {
      name?: string;
      description?: string;
      assignedToId?: string;
      estimatedPoints?: number;
      actualPoints?: number;
      recurrence?: string;
      clientUserId?: string;
    },
  ) => Promise<TaskView>;
  updateStatus: (id: string, status: TaskStatus, actualPoints?: number) => Promise<TaskView>;
  remove: (id: string) => Promise<void>;
  startTime: (id: string, note?: string) => Promise<void>;
  finishTime: (id: string, note?: string) => Promise<void>;
  getAssignees: (projectId: string) => Promise<Array<{ id: string; firstName: string; lastName: string; email: string }>>;
}

export function useTasks(filters: {
  projectId?: string;
  serviceId?: string;
  status?: TaskStatus;
  assignedToId?: string | null;
  search?: string;
} = {}): UseTasksResult {
  const [tasks, setTasks] = useState<TaskView[]>([]);
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
      const list = await api.listTasks(filters);
      if (mountedRef.current) setTasks(list);
    } catch (err) {
      if (mountedRef.current) {
        setError(toMessage(err, 'No se pudieron cargar las tareas.'));
      }
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [filters.projectId, filters.serviceId, filters.status, filters.assignedToId, filters.search]);

  useEffect(() => {
    void load();
  }, [load]);

  const create = useCallback(
    async (dto: CreateTaskInput) => {
      const t = await api.createTask(dto);
      await load();
      return t;
    },
    [load],
  );

  const update = useCallback(
    async (id: string, dto: UpdateTaskInput) => {
      const t = await api.updateTask(id, dto);
      await load();
      return t;
    },
    [load],
  );

  const updateStatus = useCallback(
    async (id: string, status: TaskStatus, actualPoints?: number) => {
      const t = await api.updateTaskStatus(id, status, actualPoints);
      await load();
      return t;
    },
    [load],
  );

  const remove = useCallback(
    async (id: string) => {
      await api.deleteTask(id);
      await load();
    },
    [load],
  );

  const startTime = useCallback(
    async (id: string, note?: string) => {
      await api.startTaskTime(id, note);
      await load();
    },
    [load],
  );

  const finishTime = useCallback(
    async (id: string, note?: string) => {
      await api.finishTaskTime(id, note);
      await load();
    },
    [load],
  );

  const getAssignees = useCallback(
    async (projectId: string) => {
      return api.getTaskAssignees(projectId);
    },
    [],
  );

  return {
    tasks,
    loading,
    error,
    refetch: load,
    create,
    update,
    updateStatus,
    remove,
    startTime,
    finishTime,
    getAssignees,
  };
}

/* ==========================================================================
   USE PROJECT DOCUMENTS HOOK
   ========================================================================== */

export interface UseProjectDocumentsResult {
  documents: ProjectDocumentView[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  upload: (
    dto: {
      name: string;
      projectId: string;
      serviceId: string;
      documentType: string;
      areaCode: string;
    },
    file: File,
  ) => Promise<ProjectDocumentView>;
  uploadRevision: (id: string, file: File) => Promise<ProjectDocumentView>;
  signQA: (id: string) => Promise<ProjectDocumentView>;
  signClient: (id: string) => Promise<ProjectDocumentView>;
  reject: (id: string, reason: string) => Promise<ProjectDocumentView>;
  remove: (id: string) => Promise<void>;
}

export function useProjectDocuments(projectId?: string, serviceId?: string): UseProjectDocumentsResult {
  const [documents, setDocuments] = useState<ProjectDocumentView[]>([]);
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
      const list = await api.listProjectDocuments(projectId, serviceId);
      if (mountedRef.current) setDocuments(list);
    } catch (err) {
      if (mountedRef.current) {
        setError(toMessage(err, 'No se pudieron cargar los documentos.'));
      }
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [projectId, serviceId]);

  useEffect(() => {
    void load();
  }, [load]);

  const upload = useCallback(
    async (dto: CreateProjectDocumentInput, file: File) => {
      const d = await api.uploadProjectDocument(dto, file);
      await load();
      return d;
    },
    [load],
  );

  const uploadRevision = useCallback(
    async (id: string, file: File) => {
      const d = await api.uploadProjectDocumentRevision(id, file);
      await load();
      return d;
    },
    [load],
  );

  const signQA = useCallback(
    async (id: string) => {
      const d = await api.signProjectDocumentQA(id);
      await load();
      return d;
    },
    [load],
  );

  const signClient = useCallback(
    async (id: string) => {
      const d = await api.signProjectDocumentClient(id);
      await load();
      return d;
    },
    [load],
  );

  const reject = useCallback(
    async (id: string, reason: string) => {
      const d = await api.rejectProjectDocument(id, reason);
      await load();
      return d;
    },
    [load],
  );

  const remove = useCallback(
    async (id: string) => {
      await api.deleteProjectDocument(id);
      await load();
    },
    [load],
  );

  return {
    documents,
    loading,
    error,
    refetch: load,
    upload,
    uploadRevision,
    signQA,
    signClient,
    reject,
    remove,
  };
}
