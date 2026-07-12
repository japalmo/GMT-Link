import { useEffect, useRef, useState, useMemo, type ReactNode } from 'react';
import {
  computeLatestPoolMetrics,
  getPoolStatus as poolStatusOf,
  computeSummaryStats,
} from './metrics-utils';
import {
  Layers,
  Activity,
  Map as MapIcon,
  TrendingUp,
  Calendar,
  Download,
  Database,
  CheckCircle2,
  User,
  Sliders,
  Plus,
  Search,
  ChevronLeft,
  Filter,
} from 'lucide-react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import {
  Modal,
  ModalContent,
  ModalHeader,
  ModalTitle,
  ModalDescription,
  ModalFooter,
  ModalClose,
} from '@/components/ui/modal';
import {
  listProjects,
  listMetricPhases,
  listMetricVariables,
  listMetricElements,
  getMetricDataPoints,
  createMetricElement,
  updateMetricElement,
  deleteMetricElement,
  type MetricElement,
  type MetricPhase,
  type MetricVariable,
  type MetricDataPoint,
} from '@/lib/api';
import type { ProjectView, ServiceView } from '@/types/operations';
import { DemViewer } from './dem-viewer';

import type L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { toast } from 'sonner';

// Satellite vs Vector maps
const TILE_LAYERS = {
  satellite: {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and GIS User Community',
  },
  vector: {
    url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
  },
};

export default function MetricsDashboard(): ReactNode {
  const [LModule, setLModule] = useState<typeof L | null>(null);

  useEffect(() => {
    import('leaflet').then((module) => {
      setLModule(module.default);
    });
  }, []);

  // Navigation & Dropdown Selection States
  const [, setProjects] = useState<ProjectView[]>([]);
  const [selectedProject, setSelectedProject] = useState<ProjectView | null>(null);
  const [selectedService, setSelectedService] = useState<ServiceView | null>(null);
  const [selectedPhase, setSelectedPhase] = useState<MetricPhase | null>(null);

  // Core Data States
  const [elements, setElements] = useState<MetricElement[]>([]);
  const [variables, setVariables] = useState<MetricVariable[]>([]);
  const [dataPoints, setDataPoints] = useState<MetricDataPoint[]>([]);

  // Selected pool/element state
  const [selectedElementId, setSelectedElementId] = useState<string | null>(null);

  // UI Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'safe' | 'warning' | 'danger'>('all');

  // Create Element Form Modal State
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [newPoolName, setNewPoolName] = useState('');
  const [newPoolCode, setNewPoolCode] = useState('');
  const [newPoolCoords, setNewPoolCoords] = useState('');
  const [newPoolEffectiveArea, setNewPoolEffectiveArea] = useState('');
  const [newPoolSafeCapacity, setNewPoolSafeCapacity] = useState('');
  const [newPoolMaxCapacity, setNewPoolMaxCapacity] = useState('');

  // Edit Element Form Modal State
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editPoolId, setEditPoolId] = useState('');
  const [editPoolName, setEditPoolName] = useState('');
  const [editPoolCode, setEditPoolCode] = useState('');
  const [editPoolCoords, setEditPoolCoords] = useState('');
  const [editPoolEffectiveArea, setEditPoolEffectiveArea] = useState('');
  const [editPoolSafeCapacity, setEditPoolSafeCapacity] = useState('');
  const [editPoolMaxCapacity, setEditPoolMaxCapacity] = useState('');

  // Date Filters for Detail View
  const [startDateFilter, setStartDateFilter] = useState('');
  const [endDateFilter, setEndDateFilter] = useState('');

  // UI States
  const [, setLoading] = useState(true);
  const [, setError] = useState<string | null>(null);
  const [mapType, setMapType] = useState<'satellite' | 'vector'>('satellite');

  // Leaflet references
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const polygonsRef = useRef<Map<string, L.Polygon>>(new Map());
  const tileLayerRef = useRef<L.TileLayer | null>(null);

  // 1. Initial Load of Projects
  const loadProjects = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await listProjects();
      setProjects(data);

      if (data.length > 0) {
        // Auto-select Atacama project (code: ATA) or default to first
        const atacama = data.find((p) => p.code.toLowerCase() === 'ata') || data[0];
        setSelectedProject(atacama || null);
      } else {
        setLoading(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al cargar proyectos');
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadProjects();
  }, []);

  // 2. Fetch Services once project is selected
  useEffect(() => {
    if (!selectedProject) return;

    const services = selectedProject.services || [];
    if (services.length > 0) {
      // Prioritize service code CUB (Cubicaciones)
      const cub = services.find((s) => s.code.toLowerCase() === 'cub') || services[0];
      setSelectedService(cub || null);
    } else {
      setSelectedService(null);
      setSelectedPhase(null);
      setElements([]);
      setVariables([]);
      setDataPoints([]);
      setLoading(false);
    }
  }, [selectedProject]);

  // 3. Fetch Phases for Selected Service
  useEffect(() => {
    if (!selectedService) return;

    const fetchPhases = async () => {
      try {
        const data = await listMetricPhases(selectedService.id);
        if (data.length > 0) {
          const activePhase = data.find((p) => p.code === 'anual-2026') || data[0];
          setSelectedPhase(activePhase ?? null);
        } else {
          setSelectedPhase(null);
          setLoading(false);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Error al cargar fases');
        setLoading(false);
      }
    };

    void fetchPhases();
  }, [selectedService]);

  // 4. Fetch Elements, Variables, and DataPoints for Selected Phase & Project
  const fetchAllData = async () => {
    if (!selectedProject || !selectedPhase) return;
    setLoading(true);
    try {
      const [elData, varData, dpData] = await Promise.all([
        listMetricElements(selectedProject.id),
        listMetricVariables(selectedPhase.id),
        getMetricDataPoints(selectedPhase.id),
      ]);

      setElements(elData);
      setVariables(varData);
      setDataPoints(dpData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al cargar datos del proyecto');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchAllData();
  }, [selectedProject, selectedPhase]);

  // Generate fallback polygons for Atacama pools (R1 to R10)
  const getDefaultPolygon = (code: string): [number, number][] => {
    const match = code.match(/\d+/);
    const num = match ? parseInt(match[0], 10) : 1;
    const row = Math.floor((num - 1) / 2); // 0..4
    const col = (num - 1) % 2; // 0..1

    // Scale coordinates to resemble real Atacama pond grids
    const baseLat = -23.639 - row * 0.005;
    const baseLng = -68.324 + col * 0.007;

    return [
      [baseLat, baseLng],
      [baseLat + 0.0035, baseLng + 0.0005],
      [baseLat + 0.003, baseLng + 0.005],
      [baseLat - 0.0005, baseLng + 0.0045],
    ];
  };

  // Helper to parse Element polygons
  const parsePolygon = (element: MetricElement): [number, number][] => {
    if (element.locationPolygon) {
      try {
        const parsed = JSON.parse(element.locationPolygon);
        if (Array.isArray(parsed) && parsed.every(pt => Array.isArray(pt) && pt.length === 2)) {
          return parsed as [number, number][];
        }
      } catch {
        // Fallback to WKT parsing or simple points
      }
    }
    return getDefaultPolygon(element.code);
  };

  // Compute latest values of each variable for each pool
  const latestPoolMetrics = useMemo(
    () => computeLatestPoolMetrics(elements, variables, dataPoints),
    [elements, variables, dataPoints],
  );

  // Compute pool alert status
  const getPoolStatus = (element: MetricElement) => poolStatusOf(element, latestPoolMetrics);

  // Compute summary stats across all pools
  const summaryStats = useMemo(
    () => computeSummaryStats(elements, latestPoolMetrics),
    [elements, latestPoolMetrics],
  );

  // Selected element data
  const selectedElement = useMemo(() => {
    return elements.find((e) => e.id === selectedElementId) || null;
  }, [elements, selectedElementId]);

  // Timeline of metrics for the selected element
  const selectedElementTimeline = useMemo(() => {
    if (!selectedElementId) return [];

    const elDps = dataPoints.filter((dp) => dp.elementId === selectedElementId);

    // Group by timestamp/date
    const grouped: Record<string, { date: string; createdBy: string; timestamp: number; [key: string]: string | number | undefined | null }> = {};

    elDps.forEach((dp) => {
      const dateObj = new Date(dp.createdAt);
      // Group by hour to match upload sessions
      const key = `${dateObj.getFullYear()}-${String(dateObj.getMonth() + 1).padStart(2, '0')}-${String(dateObj.getDate()).padStart(2, '0')} ${String(dateObj.getHours()).padStart(2, '0')}:00`;
      const dateFormatted = `${String(dateObj.getDate()).padStart(2, '0')}/${String(dateObj.getMonth() + 1).padStart(2, '0')}/${dateObj.getFullYear()} ${String(dateObj.getHours()).padStart(2, '0')}:00`;

      if (!grouped[key]) {
        grouped[key] = {
          date: dateFormatted,
          timestamp: dateObj.getTime(),
          createdBy: dp.createdBy ? `${dp.createdBy.firstName} ${dp.createdBy.lastName}` : 'Sistema',
        };
      }

      const variable = variables.find((v) => v.id === dp.variableId);
      if (variable) {
        grouped[key][variable.code] = parseFloat(dp.value);
        if (variable.type === 'FILE') {
          grouped[key][`${variable.code}_url`] = dp.fileUrl;
        }
      }
    });

    // Return chronologically sorted list
    return Object.values(grouped).sort((a, b) => a.timestamp - b.timestamp);
  }, [selectedElementId, dataPoints, variables]);

  // Filtered timeline of metrics based on selected date range
  const filteredElementTimeline = useMemo(() => {
    let list = selectedElementTimeline;
    if (startDateFilter) {
      const startMs = new Date(`${startDateFilter}T00:00:00`).getTime();
      list = list.filter((row) => row.timestamp >= startMs);
    }
    if (endDateFilter) {
      const endMs = new Date(`${endDateFilter}T23:59:59`).getTime();
      list = list.filter((row) => row.timestamp <= endMs);
    }
    return list;
  }, [selectedElementTimeline, startDateFilter, endDateFilter]);

  // Active element list sorted by alert status
  const sortedElements = useMemo(() => {
    return [...elements].sort((a, b) => {
      const statusA = getPoolStatus(a);
      const statusB = getPoolStatus(b);

      const score = { danger: 3, warning: 2, neutral: 1, safe: 0 };
      return score[statusB as keyof typeof score] - score[statusA as keyof typeof score];
    });
  }, [elements, latestPoolMetrics]);

  // Filter elements by Search & Status
  const filteredElements = useMemo(() => {
    return sortedElements.filter((el) => {
      const matchesSearch =
        el.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        el.code.toLowerCase().includes(searchQuery.toLowerCase());

      const status = getPoolStatus(el);
      const matchesStatus = statusFilter === 'all' || status === statusFilter;

      return matchesSearch && matchesStatus;
    });
  }, [sortedElements, searchQuery, statusFilter, latestPoolMetrics]);

  // Leaflet Map Initialization and Synchronization
  useEffect(() => {
    if (!LModule || !mapContainerRef.current || selectedElementId) return;

    // Destroy existing map if any
    if (mapRef.current) {
      mapRef.current.remove();
      mapRef.current = null;
      polygonsRef.current.clear();
    }

    // Centering coordinate helper (defaults to Atacama pond grid center)
    const initialCenter: [number, number] = [-23.639, -68.324];

    const map = LModule.map(mapContainerRef.current, {
      center: initialCenter,
      zoom: 12.5,
      zoomControl: false,
    });

    LModule.control.zoom({ position: 'bottomright' }).addTo(map);

    // Initial tile layer
    const config = TILE_LAYERS[mapType];
    const tileLayer = LModule.tileLayer(config.url, {
      attribution: config.attribution,
      maxZoom: 19,
    }).addTo(map);

    tileLayer.on('tileerror', () => {
      toast.error('Error al cargar el mapa', {
        description: 'No se pudieron cargar algunos sectores. Verifique su conexión.',
      });
    });

    tileLayerRef.current = tileLayer;
    mapRef.current = map;

    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
        polygonsRef.current.clear();
      }
    };
  }, [LModule, selectedElementId]);

  // Sync Map layer type
  useEffect(() => {
    const map = mapRef.current;
    if (!LModule || !map || selectedElementId) return;

    if (tileLayerRef.current) {
      map.removeLayer(tileLayerRef.current);
    }

    const config = TILE_LAYERS[mapType];
    const newLayer = LModule.tileLayer(config.url, {
      attribution: config.attribution,
      maxZoom: 19,
    }).addTo(map);

    newLayer.on('tileerror', () => {
      toast.error('Error al cargar el mapa', {
        description: 'No se pudieron cargar algunos sectores. Verifique su conexión.',
      });
    });

    tileLayerRef.current = newLayer;
  }, [LModule, mapType, selectedElementId]);

  // Render/update Polygons on the Map
  useEffect(() => {
    const map = mapRef.current;
    if (!LModule || !map || elements.length === 0 || selectedElementId) return;

    // Clear existing polygons
    polygonsRef.current.forEach((polygon) => polygon.remove());
    polygonsRef.current.clear();

    const bounds = LModule.latLngBounds([]);

    elements.forEach((el) => {
      const coordinates = parsePolygon(el);
      coordinates.forEach((coord) => bounds.extend(coord));

      const status = getPoolStatus(el);

      // Color mapping
      let fillColor = '#10b981'; // safe emerald
      let strokeColor = '#059669';

      if (status === 'danger') {
        fillColor = '#ef4444'; // red
        strokeColor = '#b91c1c';
      } else if (status === 'warning') {
        fillColor = '#f97316'; // orange
        strokeColor = '#ea580c';
      } else if (status === 'neutral') {
        fillColor = '#94a3b8'; // slate
        strokeColor = '#64748b';
      }

      const polygon = LModule.polygon(coordinates, {
        fillColor,
        fillOpacity: 0.35,
        color: strokeColor,
        weight: 1.8,
        dashArray: '3, 4',
      }).addTo(map);

      // Tooltip/Popup info
      const metrics = latestPoolMetrics[el.id] || {};
      const volSalmuera = metrics['vol_salmuera_total']
        ? parseFloat(metrics['vol_salmuera_total']).toLocaleString('es-CL')
        : 'S/D';
      const cotaEspejo = metrics['cota_espejo']
        ? parseFloat(metrics['cota_espejo']).toFixed(3)
        : 'S/D';

      const tooltipContent = `
        <div style="font-family: Inter, sans-serif; font-size: 11px; padding: 2px;">
          <b style="font-size: 13px; color: #0f172a;">${el.name} (${el.code})</b><br/>
          <div style="margin-top: 4px; display: flex; flex-direction: column; gap: 2px;">
            <span>💧 Cota Espejo: <b>${cotaEspejo} m</b></span>
            <span>📊 Vol. Salmuera: <b>${volSalmuera} m³</b></span>
            <span>⚠️ Estado: <b style="color: ${
              status === 'danger' ? '#ef4444' : status === 'warning' ? '#f97316' : '#10b981'
            }">${status.toUpperCase()}</b></span>
          </div>
        </div>
      `;

      polygon.bindTooltip(tooltipContent, { permanent: false, direction: 'center' });

      polygon.on('click', () => {
        setSelectedElementId(el.id);
      });

      polygonsRef.current.set(el.id, polygon);
    });

    // Zoom/Fit bounds
    if (bounds.isValid()) {
      map.fitBounds(bounds, { padding: [30, 30] });
    }
  }, [LModule, elements, latestPoolMetrics, selectedElementId]);

  // CSV Exporter
  const handleExportCSV = () => {
    if (!selectedElement || filteredElementTimeline.length === 0) return;

    let csvContent = 'data:text/csv;charset=utf-8,';
    csvContent += 'Fecha,Operador,Cota Espejo (m),Borde Libre (m),Altura Salmuera (m),Altura Sal (m),Volumen Total Salmuera (m3),Volumen Salmuera Libre (m3),Volumen Salmuera Ocluida (m3),Volumen Sal (m3),Area Espejo (m2),Perimetro (m)\n';

    filteredElementTimeline.forEach((row) => {
      const cotaEsp = row['cota_espejo'] ?? '';
      const bordeLib = row['borde_libre'] ?? '';
      const altSalmuera = row['altura_salmuera'] ?? '';
      const altSal = row['altura_sal'] ?? '';
      const volTot = row['vol_salmuera_total'] ?? '';
      const volLib = row['vol_salmuera_libre'] ?? '';
      const volOcl = row['vol_salmuera_ocluida'] ?? '';
      const volS = row['vol_sal'] ?? '';
      const areaEsp = row['area_espejo'] ?? '';
      const per = row['perimetro'] ?? '';

      csvContent += `"${row.date}","${row.createdBy}",${cotaEsp},${bordeLib},${altSalmuera},${altSal},${volTot},${volLib},${volOcl},${volS},${areaEsp},${per}\n`;
    });

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `cubicacion_${selectedElement.code}_${selectedPhase?.code}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Editing and Deleting pools
  const handleOpenEditModal = (el: MetricElement) => {
    setEditPoolId(el.id);
    setEditPoolName(el.name);
    setEditPoolCode(el.code);
    setEditPoolCoords(el.locationPolygon || '');
    
    const limits: Record<string, number> =
      (el.metadata?.limits as Record<string, number> | undefined) ?? {};
    setEditPoolEffectiveArea(limits.effective_area ? String(limits.effective_area) : '');
    setEditPoolSafeCapacity(limits.safe_capacity ? String(limits.safe_capacity) : '');
    setEditPoolMaxCapacity(limits.max_nominal_capacity ? String(limits.max_nominal_capacity) : '');
    setIsEditModalOpen(true);
  };

  const handleUpdatePool = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editPoolName || !editPoolCode) {
      toast.error('El nombre y código son campos requeridos.');
      return;
    }

    try {
      let polygonStr: string | null = null;
      if (editPoolCoords.trim()) {
        try {
          const parsed = JSON.parse(editPoolCoords);
          if (Array.isArray(parsed) && parsed.every(pt => Array.isArray(pt) && pt.length === 2)) {
            polygonStr = JSON.stringify(parsed);
          } else {
            throw new Error();
          }
        } catch {
          toast.error('Formato de coordenadas inválido. Debe ser una matriz JSON: [[lat, lon], ...]');
          return;
        }
      } else {
        polygonStr = null;
      }

      const metadata = {
        limits: {
          effective_area: parseFloat(editPoolEffectiveArea) || 0,
          safe_capacity: parseFloat(editPoolSafeCapacity) || 0,
          max_nominal_capacity: parseFloat(editPoolMaxCapacity) || 0,
        },
      };

      await updateMetricElement(editPoolId, {
        code: editPoolCode,
        name: editPoolName,
        type: 'POZA',
        locationPolygon: polygonStr,
        metadata,
        projectId: selectedProject?.id || '',
      });

      toast.success('Vaso de evaporación actualizado correctamente.');
      setIsEditModalOpen(false);
      
      // Reload
      await fetchAllData();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al actualizar el vaso de evaporación.');
    }
  };

  const handleDeletePool = async (id: string) => {
    if (!window.confirm('¿Está seguro de que desea eliminar este reservorio? Se eliminarán también todas sus mediciones históricas asociadas.')) {
      return;
    }

    try {
      await deleteMetricElement(id);
      toast.success('Vaso de evaporación eliminado correctamente.');
      setSelectedElementId(null);
      await fetchAllData();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al eliminar el vaso de evaporación.');
    }
  };

  // Creating a new pool
  const handleCreatePool = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPoolName || !newPoolCode) {
      toast.error('El nombre y código son campos requeridos.');
      return;
    }

    try {
      let polygonStr: string | null = null;
      if (newPoolCoords.trim()) {
        try {
          const parsed = JSON.parse(newPoolCoords);
          if (Array.isArray(parsed) && parsed.every(pt => Array.isArray(pt) && pt.length === 2)) {
            polygonStr = JSON.stringify(parsed);
          } else {
            throw new Error();
          }
        } catch {
          toast.error('Formato de coordenadas inválido. Debe ser una matriz JSON: [[lat, lon], ...]');
          return;
        }
      } else {
        // Generate default coords relative to center
        polygonStr = JSON.stringify(getDefaultPolygon(newPoolCode));
      }

      const metadata = {
        limits: {
          effective_area: parseFloat(newPoolEffectiveArea) || 0,
          safe_capacity: parseFloat(newPoolSafeCapacity) || 0,
          max_nominal_capacity: parseFloat(newPoolMaxCapacity) || 0,
        },
      };

      await createMetricElement({
        code: newPoolCode,
        name: newPoolName,
        type: 'POZA',
        locationPolygon: polygonStr,
        metadata,
        projectId: selectedProject?.id || '',
      });

      toast.success('Vasode evaporación creado correctamente.');
      setIsCreateModalOpen(false);
      
      // Clean inputs
      setNewPoolName('');
      setNewPoolCode('');
      setNewPoolCoords('');
      setNewPoolEffectiveArea('');
      setNewPoolSafeCapacity('');
      setNewPoolMaxCapacity('');

      // Reload
      await fetchAllData();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al registrar el vaso de evaporación.');
    }
  };

  // Custom SVGs for Volume vs Date (only total volume and salt volume)
  const renderDetailVolumesChart = () => {
    const timeline = filteredElementTimeline;
    if (timeline.length < 2) {
      return (
        <div className="h-full flex items-center justify-center text-xs text-muted-foreground border border-dashed border-border/80 rounded-xl bg-accent/5">
          Se requieren al menos 2 mediciones históricas para proyectar tendencias.
        </div>
      );
    }

    const width = 500;
    const height = 180;
    const padding = 35;

    // Find min and max values
    const allVals = timeline.flatMap((d) => [
      Number(d['vol_salmuera_total'] || 0),
      Number(d['vol_sal'] || 0),
    ]);
    const maxVal = Math.max(...allVals, 1000) * 1.1; // padding top
    const minVal = 0; // standard floor

    const getX = (index: number) => padding + (index / (timeline.length - 1)) * (width - 2 * padding);
    const getY = (val: number) => height - padding - ((val - minVal) / (maxVal - minVal)) * (height - 2 * padding);

    // Build SVG paths
    const buildPath = (key: string) => {
      return timeline
        .map((d, i) => {
          const val = Number(d[key] || 0);
          return `${i === 0 ? 'M' : 'L'} ${getX(i)} ${getY(val)}`;
        })
        .join(' ');
    };

    const buildAreaPath = (key: string) => {
      const linePath = buildPath(key);
      if (!linePath) return '';
      const startX = getX(0);
      const endX = getX(timeline.length - 1);
      const bottomY = height - padding;
      return `${linePath} L ${endX} ${bottomY} L ${startX} ${bottomY} Z`;
    };

    return (
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-full text-foreground select-none">
        <defs>
          <linearGradient id="gradTotalDetail" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#f97316" stopOpacity="0.3" />
            <stop offset="100%" stopColor="#f97316" stopOpacity="0.0" />
          </linearGradient>
          <linearGradient id="gradSalDetail" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#eab308" stopOpacity="0.3" />
            <stop offset="100%" stopColor="#eab308" stopOpacity="0.0" />
          </linearGradient>
        </defs>

        {/* Horizontal gridlines */}
        {[0, 0.25, 0.5, 0.75, 1].map((ratio, idx) => {
          const val = minVal + ratio * (maxVal - minVal);
          const y = getY(val);
          return (
            <g key={idx} className="opacity-40">
              <line
                x1={padding}
                y1={y}
                x2={width - padding}
                y2={y}
                stroke="currentColor"
                strokeWidth="0.5"
                strokeDasharray="2, 3"
              />
              <text
                x={padding - 5}
                y={y + 3}
                textAnchor="end"
                className="fill-muted-foreground font-mono text-[9px]"
              >
                {val >= 1000 ? `${(val / 1000).toFixed(0)}k` : val.toFixed(0)}
              </text>
            </g>
          );
        })}

        {/* X Axis dates */}
        <g className="opacity-70">
          <text x={padding} y={height - 10} textAnchor="start" className="fill-muted-foreground text-[8px] font-semibold">
            {timeline[0]?.date.split(' ')[0] || ''}
          </text>
          <text x={width - padding} y={height - 10} textAnchor="end" className="fill-muted-foreground text-[8px] font-semibold">
            {timeline[timeline.length - 1]?.date.split(' ')[0] || ''}
          </text>
        </g>

        {/* Areas */}
        <path d={buildAreaPath('vol_salmuera_total')} fill="url(#gradTotalDetail)" />
        <path d={buildAreaPath('vol_sal')} fill="url(#gradSalDetail)" />

        {/* Lines */}
        <path d={buildPath('vol_salmuera_total')} fill="none" stroke="#f97316" strokeWidth="2.2" />
        <path d={buildPath('vol_sal')} fill="none" stroke="#eab308" strokeWidth="1.8" />

        {/* Interactive nodes */}
        {timeline.map((d, i) => {
          const cx = getX(i);
          const totY = getY(Number(d['vol_salmuera_total'] || 0));
          return (
            <g key={i} className="group cursor-pointer">
              <circle cx={cx} cy={totY} r="3" className="fill-orange-500 hover:r-5 transition-all" />
              <title>{`Fecha: ${d.date}\nVol. Total: ${d['vol_salmuera_total']?.toLocaleString('es-CL')} m³\nVol. Sal: ${d['vol_sal']?.toLocaleString('es-CL')} m³`}</title>
            </g>
          );
        })}
      </svg>
    );
  };

  // Recent Uploads list (across all elements)
  const recentUploads = useMemo(() => {
    const list: Array<{
      id: string;
      createdAt: string;
      pozaName: string;
      pozaCode: string;
      operator: string;
      otpVerified: boolean;
      cotaEspejo?: string;
      volSalmuera?: string;
      volSal?: string;
    }> = [];

    const grouped: Record<string, { createdAt: string; elId: string; userId: string; dps: MetricDataPoint[] }> = {};

    dataPoints.forEach((dp) => {
      const key = `${dp.createdAt}_${dp.createdById}_${dp.elementId}`;
      if (!grouped[key]) {
        grouped[key] = {
          createdAt: dp.createdAt,
          elId: dp.elementId || '',
          userId: dp.createdById,
          dps: [],
        };
      }
      grouped[key].dps.push(dp);
    });

    Object.values(grouped).forEach((group, idx) => {
      const el = elements.find((e) => e.id === group.elId);
      if (!el) return;

      const firstDp = group.dps[0];
      if (!firstDp) return;

      const metrics: Record<string, string> = {};
      group.dps.forEach((dp) => {
        const variable = variables.find((v) => v.id === dp.variableId);
        if (variable) metrics[variable.code] = dp.value;
      });

      list.push({
        id: `${firstDp.id}_${idx}`,
        createdAt: group.createdAt,
        pozaName: el.name,
        pozaCode: el.code,
        operator: firstDp.createdBy ? `${firstDp.createdBy.firstName} ${firstDp.createdBy.lastName}` : 'Sistema',
        otpVerified: true,
        cotaEspejo: metrics['cota_espejo'],
        volSalmuera: metrics['vol_salmuera_total'],
        volSal: metrics['vol_sal'],
      });
    });

    return list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 10);
  }, [dataPoints, elements, variables]);

  /* ======================================================================== */
  /* DETAIL VIEW SCREEN                                                       */
  /* ======================================================================== */
  if (selectedElementId && selectedElement) {
    const limits: Record<string, number> =
      (selectedElement.metadata?.limits as Record<string, number> | undefined) || {
      effective_area: 0,
      safe_capacity: 0,
      max_nominal_capacity: 0,
    };

    return (
      <div className="flex flex-col gap-6 w-full max-w-7xl mx-auto px-4 py-6">
        {/* Detail Header */}
        <header className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-card/45 backdrop-blur-md border border-border/60 rounded-2xl p-6 shadow-sm">
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              size="icon"
              onClick={() => {
                setSelectedElementId(null);
                setStartDateFilter('');
                setEndDateFilter('');
              }}
              className="size-10 rounded-xl border-border/80 hover:bg-primary/5 shrink-0"
              aria-label="Volver al mapa"
            >
              <ChevronLeft className="size-5" />
            </Button>
            <div>
              <h1 className="text-xl font-bold flex items-center gap-2">
                {selectedElement.name}
                <Badge variant="outline" className="font-mono text-[10px] bg-accent/30 font-bold border-border">
                  {selectedElement.code}
                </Badge>
              </h1>
              <p className="text-xs text-muted-foreground mt-0.5">
                Campaña: {selectedPhase?.name} · Detalle de cubicación volumétrica y modelo 3D
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <Button
              size="sm"
              variant="outline"
              onClick={() => handleOpenEditModal(selectedElement)}
              className="text-xs font-bold border-border/80 hover:bg-primary/5 h-9 rounded-xl"
            >
              Editar Poza
            </Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={() => handleDeletePool(selectedElement.id)}
              className="text-xs font-bold bg-red-600 hover:bg-red-700 text-white h-9 rounded-xl border-none"
            >
              Eliminar
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={handleExportCSV}
              disabled={filteredElementTimeline.length === 0}
              className="text-xs font-bold border-border/80 hover:bg-primary/5 h-9 rounded-xl"
            >
              <Download className="size-3.5 mr-1" /> Exportar CSV
            </Button>
          </div>
        </header>

        {/* Harvest Limits Cards */}
        <section className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Card className="border border-border/60 shadow-sm bg-card/65 relative overflow-hidden">
            <CardHeader className="pb-2">
              <CardDescription className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Área Operacional Efectiva
              </CardDescription>
              <CardTitle className="text-2xl font-black text-emerald-500">
                {limits.effective_area ? Number(limits.effective_area).toLocaleString('es-CL') : '—'}{' '}
                <span className="text-sm font-medium text-muted-foreground">m²</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-[10px] text-muted-foreground">Superficie disponible de evaporación útil.</p>
            </CardContent>
          </Card>

          <Card className="border border-border/60 shadow-sm bg-card/65 relative overflow-hidden">
            <CardHeader className="pb-2">
              <CardDescription className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Capacidad Operativa de Seguridad
              </CardDescription>
              <CardTitle className="text-2xl font-black text-orange-500">
                {limits.safe_capacity ? Number(limits.safe_capacity).toLocaleString('es-CL') : '—'}{' '}
                <span className="text-sm font-medium text-muted-foreground">m³</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-[10px] text-muted-foreground">Límite volumétrico operacional seguro del vaso.</p>
            </CardContent>
          </Card>

          <Card className="border border-border/60 shadow-sm bg-card/65 relative overflow-hidden">
            <CardHeader className="pb-2">
              <CardDescription className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Capacidad Hidráulica Máxima
              </CardDescription>
              <CardTitle className="text-2xl font-black text-red-500">
                {limits.max_nominal_capacity ? Number(limits.max_nominal_capacity).toLocaleString('es-CL') : '—'}{' '}
                <span className="text-sm font-medium text-muted-foreground">m³</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-[10px] text-muted-foreground">Capacidad extrema antes de reventar o desborde.</p>
            </CardContent>
          </Card>
        </section>

        {/* Date Filter Toolbar */}
        <section className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-card/35 border border-border/50 rounded-xl p-4 shadow-sm">
          <div className="flex items-center gap-2">
            <Calendar className="size-4 text-orange-500" />
            <span className="text-xs font-bold text-foreground">Filtrar cubicaciones por rango de fecha:</span>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <Label htmlFor="startDate" className="text-[10px] font-semibold text-muted-foreground uppercase">Desde</Label>
              <Input
                id="startDate"
                type="date"
                value={startDateFilter}
                onChange={(e) => setStartDateFilter(e.target.value)}
                className="h-8 w-auto px-2.5 py-1 text-xs"
              />
            </div>
            <div className="flex items-center gap-2">
              <Label htmlFor="endDate" className="text-[10px] font-semibold text-muted-foreground uppercase">Hasta</Label>
              <Input
                id="endDate"
                type="date"
                value={endDateFilter}
                onChange={(e) => setEndDateFilter(e.target.value)}
                className="h-8 w-auto px-2.5 py-1 text-xs"
              />
            </div>
            {(startDateFilter || endDateFilter) && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setStartDateFilter('');
                  setEndDateFilter('');
                }}
                className="text-[10px] font-bold text-red-500 hover:text-red-600 px-2 py-1 h-7"
              >
                Limpiar Filtros
              </Button>
            )}
          </div>
        </section>

        {/* 3D Viewer & Vol Chart */}
        <section className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-7">
            <DemViewer code={selectedElement.code} />
          </div>

          <Card className="lg:col-span-5 border border-border/60 shadow-md bg-card/50 backdrop-blur-md">
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <TrendingUp className="size-4 text-orange-500" />
                Histórico de Volúmenes (m³)
              </CardTitle>
              <CardDescription className="text-xs">
                Volumen total de salmuera libre + ocluida vs. volumen de sal
              </CardDescription>
            </CardHeader>
            <CardContent className="h-[400px] flex flex-col justify-between">
              <div className="flex-1 min-h-0 bg-accent/10 border border-border/60 rounded-xl p-3">
                {renderDetailVolumesChart()}
              </div>
              <div className="flex items-center justify-center gap-6 text-[10px] font-bold mt-4 pt-2 border-t border-border/30">
                <span className="flex items-center gap-1.5"><span className="size-3 rounded bg-orange-500" /> Vol. Total Salmuera</span>
                <span className="flex items-center gap-1.5"><span className="size-3 rounded bg-yellow-500" /> Vol. de Sal</span>
              </div>
            </CardContent>
          </Card>
        </section>

        {/* Table of Pool Records */}
        <Card className="border border-border/60 shadow-sm bg-card/45 backdrop-blur-md">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Historial Completo de Cubicaciones</CardTitle>
            <CardDescription className="text-xs">
              Todas las mediciones almacenadas para este reservorio ordenadas cronológicamente.
            </CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto p-0 border-t border-border/60">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-border/60 bg-accent/10 font-semibold text-muted-foreground">
                  <th className="p-3">Fecha</th>
                  <th className="p-3">Operador</th>
                  <th className="p-3 text-right">Cota Esp. (m)</th>
                  <th className="p-3 text-right">Borde Lib. (m)</th>
                  <th className="p-3 text-right">Alt. Salm. (m)</th>
                  <th className="p-3 text-right">Alt. Sal (m)</th>
                  <th className="p-3 text-right">Área Esp. (m²)</th>
                  <th className="p-3 text-right">Perím. (m)</th>
                  <th className="p-3 text-right">Vol. Lib. (m³)</th>
                  <th className="p-3 text-right">Vol. Sal (m³)</th>
                  <th className="p-3 text-right">Vol. Ocl. (m³)</th>
                  <th className="p-3 text-right">Vol. Total (m³)</th>
                </tr>
              </thead>
              <tbody>
                {filteredElementTimeline.length > 0 ? (
                  filteredElementTimeline.map((row, idx) => {
                    const cotaEspejo = row.cota_espejo !== undefined ? Number(row.cota_espejo).toFixed(3) : '—';
                    const bordeLibre = row.borde_libre !== undefined ? Number(row.borde_libre).toFixed(2) : '—';
                    const alturaSalmuera = row.altura_salmuera !== undefined ? Number(row.altura_salmuera).toFixed(2) : '—';
                    const alturaSal = row.altura_sal !== undefined ? Number(row.altura_sal).toFixed(2) : '—';
                    const areaEspejo = row.area_espejo !== undefined ? Number(row.area_espejo).toLocaleString('es-CL') : '—';
                    const perimetro = row.perimetro !== undefined ? Number(row.perimetro).toLocaleString('es-CL') : '—';
                    const volLibre = row.vol_salmuera_libre !== undefined ? Number(row.vol_salmuera_libre).toLocaleString('es-CL') : '—';
                    const volSal = row.vol_sal !== undefined ? Number(row.vol_sal).toLocaleString('es-CL') : '—';
                    const volOcl = row.vol_salmuera_ocluida !== undefined ? Number(row.vol_salmuera_ocluida).toLocaleString('es-CL') : '—';
                    const volTotal = row.vol_salmuera_total !== undefined ? Number(row.vol_salmuera_total).toLocaleString('es-CL') : '—';

                    return (
                      <tr key={idx} className="border-b border-border/40 hover:bg-accent/5">
                        <td className="p-3 font-medium font-mono text-muted-foreground">{row.date}</td>
                        <td className="p-3">{row.createdBy}</td>
                        <td className="p-3 text-right font-mono font-semibold text-blue-600">{cotaEspejo}</td>
                        <td className="p-3 text-right font-mono">{bordeLibre}</td>
                        <td className="p-3 text-right font-mono">{alturaSalmuera}</td>
                        <td className="p-3 text-right font-mono">{alturaSal}</td>
                        <td className="p-3 text-right font-mono">{areaEspejo}</td>
                        <td className="p-3 text-right font-mono">{perimetro}</td>
                        <td className="p-3 text-right font-mono text-cyan-600">{volLibre}</td>
                        <td className="p-3 text-right font-mono text-amber-600">{volSal}</td>
                        <td className="p-3 text-right font-mono text-muted-foreground">{volOcl}</td>
                        <td className="p-3 text-right font-mono font-bold text-orange-600">{volTotal}</td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={12} className="p-8 text-center text-muted-foreground">
                      No se han encontrado registros de cubicaciones para este reservorio.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </div>
    );
  }

  /* ======================================================================== */
  /* MAIN MAP & GIS LIST SCREEN                                               */
  /* ======================================================================== */
  return (
    <div className="flex flex-col gap-6 w-full max-w-7xl mx-auto px-4 py-6">
      {/* Main Header */}
      <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-card/45 backdrop-blur-md border border-border/60 rounded-2xl p-6 shadow-sm">
        <div className="flex items-center gap-4">
          <div className="bg-orange-500/10 border border-orange-500/25 size-12 rounded-xl flex items-center justify-center text-orange-500 shadow-inner">
            <Layers className="size-6 animate-pulse" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">V-Metric: Salar de Atacama</h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              Cubicación y monitoreo volumétrico de Pozas de Salmuera en Atacama
            </p>
          </div>
        </div>

        {/* Campaign Info */}
        <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
          {selectedProject && (
            <div className="flex items-center gap-1.5 bg-accent/25 border border-border/80 rounded-xl px-3 py-1.5 text-xs">
              <Sliders className="size-3.5 text-muted-foreground" />
              <span className="font-semibold text-muted-foreground">Proyecto:</span>
              <span className="font-bold text-foreground">{selectedProject.name}</span>
            </div>
          )}
          {selectedService && (
            <div className="flex items-center gap-1.5 bg-accent/25 border border-border/80 rounded-xl px-3 py-1.5 text-xs">
              <Database className="size-3.5 text-muted-foreground" />
              <span className="font-semibold text-muted-foreground">Servicio:</span>
              <span className="font-bold text-foreground">{selectedService.name}</span>
            </div>
          )}
          {selectedPhase && (
            <div className="flex items-center gap-1.5 bg-accent/25 border border-border/80 rounded-xl px-3 py-1.5 text-xs">
              <Calendar className="size-3.5 text-muted-foreground" />
              <span className="font-semibold text-muted-foreground">Campaña:</span>
              <span className="font-bold text-foreground">{selectedPhase.name}</span>
            </div>
          )}
        </div>
      </header>

      {/* KPI Cards Summary Row */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="border border-border/60 shadow-sm bg-card/65 relative overflow-hidden group">
          <div className="absolute top-0 right-0 p-3 text-orange-500 opacity-10 group-hover:scale-110 transition-transform">
            <Activity className="size-20" />
          </div>
          <CardHeader className="pb-2">
            <CardDescription className="text-xs font-semibold uppercase tracking-wider">Volumen Salmuera Total</CardDescription>
            <CardTitle className="text-2xl font-black text-orange-500">
              {summaryStats.totalBrineVolume.toLocaleString('es-CL')} <span className="text-sm font-medium text-muted-foreground">m³</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-[10px] text-muted-foreground">Acumulado bruto de todas las pozas del yacimiento.</p>
          </CardContent>
        </Card>

        <Card className="border border-border/60 shadow-sm bg-card/65 relative overflow-hidden group">
          <div className="absolute top-0 right-0 p-3 text-cyan-500 opacity-10 group-hover:scale-110 transition-transform">
            <Activity className="size-20" />
          </div>
          <CardHeader className="pb-2">
            <CardDescription className="text-xs font-semibold uppercase tracking-wider">Volumen Salmuera Libre</CardDescription>
            <CardTitle className="text-2xl font-black text-cyan-500">
              {summaryStats.totalFreeVolume.toLocaleString('es-CL')} <span className="text-sm font-medium text-muted-foreground">m³</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-[10px] text-muted-foreground">Salmuera líquida dispuesta para bombeo / transferencia.</p>
          </CardContent>
        </Card>

        <Card className="border border-border/60 shadow-sm bg-card/65 relative overflow-hidden group">
          <div className="absolute top-0 right-0 p-3 text-amber-500 opacity-10 group-hover:scale-110 transition-transform">
            <Activity className="size-20" />
          </div>
          <CardHeader className="pb-2">
            <CardDescription className="text-xs font-semibold uppercase tracking-wider">Volumen de Sal Decantada</CardDescription>
            <CardTitle className="text-2xl font-black text-amber-500">
              {summaryStats.totalDecantedSalt.toLocaleString('es-CL')} <span className="text-sm font-medium text-muted-foreground">m³</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-[10px] text-muted-foreground">Capa de halita consolidada en el fondo del estanque.</p>
          </CardContent>
        </Card>

        <Card className="border border-border/60 shadow-sm bg-card/65 relative overflow-hidden group">
          <div className="absolute top-0 right-0 p-3 text-emerald-500 opacity-10 group-hover:scale-110 transition-transform">
            <MapIcon className="size-20" />
          </div>
          <CardHeader className="pb-2">
            <CardDescription className="text-xs font-semibold uppercase tracking-wider">Estanques / Pozas</CardDescription>
            <CardTitle className="text-2xl font-black text-emerald-500">
              {summaryStats.poolCount} <span className="text-sm font-medium text-muted-foreground">Activas</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-[10px] text-muted-foreground">Unidades de evaporación solar controladas en Atacama.</p>
          </CardContent>
        </Card>
      </section>

      {/* Main Content Grid: Map & Details */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Side: Pool List and Filters */}
        <div className="lg:col-span-5 flex flex-col gap-6">
          <Card className="border border-border/60 shadow-sm bg-card/45 backdrop-blur-md">
            <CardHeader className="pb-3 border-b border-border/60 flex flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle className="text-sm font-bold flex items-center gap-2">
                  <Filter className="size-4 text-orange-500" />
                  Filtro y Catálogo de Vasos
                </CardTitle>
              </div>
              
              {/* Create Pool trigger */}
              <Button
                size="sm"
                className="h-8 text-xs font-bold bg-orange-600 hover:bg-orange-700 text-white rounded-xl shadow-md transition-all flex items-center gap-1"
                onClick={() => setIsCreateModalOpen(true)}
              >
                <Plus className="size-3.5" />
                Crear Poza
              </Button>
            </CardHeader>

            <CardContent className="pt-4 flex flex-col gap-4">
              {/* Filter inputs */}
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
                  <Input
                    placeholder="Buscar poza por código o nombre..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-9 text-xs rounded-xl h-9"
                  />
                </div>
                
                <Select
                  aria-label="Filtrar pozas por estado"
                  value={statusFilter}
                  onChange={(e) =>
                    setStatusFilter(e.target.value as 'all' | 'safe' | 'warning' | 'danger')
                  }
                  className="w-auto rounded-xl text-xs"
                >
                  <option value="all">Todos los Estados</option>
                  <option value="safe">Seguro</option>
                  <option value="warning">Precaución</option>
                  <option value="danger">Crítico</option>
                </Select>
              </div>

              {/* Elements scrollable box */}
              <div className="max-h-96 overflow-y-auto pr-2 flex flex-col gap-2">
                {filteredElements.length > 0 ? (
                  filteredElements.map((el) => {
                    const status = getPoolStatus(el);
                    const metrics = latestPoolMetrics[el.id] || {};
                    const cotaEspejo = metrics['cota_espejo'] ? `${parseFloat(metrics['cota_espejo']).toFixed(2)} m` : 'S/D';

                    return (
                      <button
                        key={el.id}
                        onClick={() => {
                          setSelectedElementId(el.id);
                        }}
                        className="flex items-center justify-between p-3 rounded-xl border border-border/60 hover:bg-orange-500/5 hover:border-orange-500/40 text-left transition-all group"
                      >
                        <div className="flex items-center gap-2">
                          <span
                            className={`size-2.5 rounded-full ${
                              status === 'danger'
                                ? 'bg-red-500 shadow-[0_0_8px_#ef4444]'
                                : status === 'warning'
                                  ? 'bg-orange-500 shadow-[0_0_8px_#f97316]'
                                  : status === 'safe'
                                    ? 'bg-emerald-500'
                                    : 'bg-slate-400'
                            }`}
                          />
                          <div>
                            <p className="text-xs font-bold text-foreground group-hover:text-orange-500 transition-colors">{el.name}</p>
                            <p className="text-[10px] font-mono text-muted-foreground">{el.code}</p>
                          </div>
                        </div>

                        <div className="text-right">
                          <p className="text-xs font-bold text-foreground">{cotaEspejo}</p>
                          <p className="text-[9px] text-muted-foreground">Cota Espejo</p>
                        </div>
                      </button>
                    );
                  })
                ) : (
                  <p className="text-center text-xs text-muted-foreground py-8 border border-dashed border-border/50 rounded-xl">
                    No se encontraron pozas que coincidan con los filtros.
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right Side: Map */}
        <div className="lg:col-span-7 flex flex-col gap-6">
          <Card className="border border-border/60 shadow-sm bg-card/45 backdrop-blur-md overflow-hidden">
            <CardHeader className="pb-3 flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-md font-bold flex items-center gap-2">
                  <MapIcon className="size-4 text-orange-500" />
                  Plano Cartográfico Satelital de Evaporadores
                </CardTitle>
                <CardDescription>
                  Georreferenciación de los vasos con sus últimas mediciones de nivel.
                </CardDescription>
              </div>

              {/* Map Layer Switcher */}
              <div className="flex border border-border/60 rounded-xl overflow-hidden text-xs">
                <button
                  onClick={() => setMapType('satellite')}
                  className={`px-3 py-1.5 font-bold transition-all ${
                    mapType === 'satellite'
                      ? 'bg-orange-500 text-white shadow-sm'
                      : 'hover:bg-accent/40 text-muted-foreground'
                  }`}
                >
                  Satelital
                </button>
                <button
                  onClick={() => setMapType('vector')}
                  className={`px-3 py-1.5 font-bold transition-all ${
                    mapType === 'vector'
                      ? 'bg-orange-500 text-white shadow-sm'
                      : 'hover:bg-accent/40 text-muted-foreground'
                  }`}
                >
                  Vectorial
                </button>
              </div>
            </CardHeader>

            <CardContent className="p-0 border-t border-border/60">
              <div className="h-[432px] w-full relative z-0">
                <div ref={mapContainerRef} className="w-full h-full" />
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Recent Uploads Table (Recent Registrations Log) */}
      <section className="bg-card/45 backdrop-blur-md border border-border/60 rounded-2xl p-6 shadow-sm">
        <header className="mb-4 flex justify-between items-center">
          <div>
            <h2 className="text-md font-bold flex items-center gap-2">
              <CheckCircle2 className="size-4 text-emerald-500" />
              Log de Últimos Registros
            </h2>
            <p className="text-xs text-muted-foreground">
              Últimas mediciones consolidadas desde el cliente de escritorio V-Metric.
            </p>
          </div>
          <Badge variant="outline" className="bg-emerald-500/10 border-emerald-500/25 text-emerald-600 font-bold text-[10px]">
            Firma OTP Asegurada
          </Badge>
        </header>

        <div className="overflow-x-auto rounded-xl border border-border/60 bg-accent/5">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-border/60 bg-accent/15 font-semibold text-muted-foreground">
                <th className="p-3">Fecha / Hora</th>
                <th className="p-3">Vaso / Poza</th>
                <th className="p-3">Operador Autorizado</th>
                <th className="p-3 text-right">Cota Espejo (m)</th>
                <th className="p-3 text-right">Volumen Total (m³)</th>
                <th className="p-3 text-right">Volumen Sal (m³)</th>
                <th className="p-3 text-center">Firma Digital (OTP)</th>
              </tr>
            </thead>
            <tbody>
              {recentUploads.length > 0 ? (
                recentUploads.map((row) => (
                  <tr key={row.id} className="border-b border-border/60 last:border-none hover:bg-accent/10 transition-colors">
                    <td className="p-3 font-mono text-muted-foreground">
                      {new Date(row.createdAt).toLocaleString('es-CL', {
                        day: '2-digit',
                        month: '2-digit',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </td>
                    <td className="p-3">
                      <div className="font-bold text-foreground">{row.pozaName}</div>
                      <div className="text-[10px] text-muted-foreground font-mono">{row.pozaCode}</div>
                    </td>
                    <td className="p-3 flex items-center gap-1.5 text-muted-foreground">
                      <User className="size-3.5 text-muted-foreground" />
                      {row.operator}
                    </td>
                    <td className="p-3 text-right font-mono font-semibold">
                      {row.cotaEspejo ? parseFloat(row.cotaEspejo).toFixed(3) : '—'}
                    </td>
                    <td className="p-3 text-right font-mono font-bold text-orange-500/90">
                      {row.volSalmuera ? parseFloat(row.volSalmuera).toLocaleString('es-CL') : '—'}
                    </td>
                    <td className="p-3 text-right font-mono font-semibold text-amber-600/90">
                      {row.volSal ? parseFloat(row.volSal).toLocaleString('es-CL') : '—'}
                    </td>
                    <td className="p-3 text-center">
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[9px] font-bold bg-emerald-500/10 border border-emerald-500/25 text-emerald-600">
                        <CheckCircle2 className="size-3" /> VERIFICADO
                      </span>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-muted-foreground">
                    No se han registrado cubicaciones todavía en esta campaña.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* CREATE ELEMENT MODAL DIALOG */}
      <Modal open={isCreateModalOpen} onOpenChange={setIsCreateModalOpen}>
        <ModalContent className="max-w-md bg-card border border-border shadow-xl rounded-2xl p-6">
          <form onSubmit={handleCreatePool} className="flex flex-col gap-4">
            <ModalHeader>
              <ModalTitle className="text-lg font-bold">Crear Vaso de Evaporación</ModalTitle>
              <ModalDescription className="text-xs text-muted-foreground">
                Registre un nuevo reservorio en el proyecto {selectedProject?.name}.
              </ModalDescription>
            </ModalHeader>

            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="poolCode" className="text-xs font-semibold">Código del Reservorio</Label>
                <Input
                  id="poolCode"
                  placeholder="Ej: R11"
                  value={newPoolCode}
                  onChange={(e) => setNewPoolCode(e.target.value)}
                  className="text-xs h-9 rounded-xl"
                  required
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="poolName" className="text-xs font-semibold">Nombre descriptivo</Label>
                <Input
                  id="poolName"
                  placeholder="Ej: Reservorio 11"
                  value={newPoolName}
                  onChange={(e) => setNewPoolName(e.target.value)}
                  className="text-xs h-9 rounded-xl"
                  required
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="poolCoords" className="text-xs font-semibold">Polígono básico delimitador (Opcional)</Label>
                <Input
                  id="poolCoords"
                  placeholder="Ej: [[-23.63, -68.32], [-23.64, -68.33], ...]"
                  value={newPoolCoords}
                  onChange={(e) => setNewPoolCoords(e.target.value)}
                  className="text-xs h-9 rounded-xl font-mono"
                />
                <span className="text-[10px] text-muted-foreground font-medium">
                  Matriz JSON de coordenadas [lat, lon]. Si se deja vacío se generará uno por defecto.
                </span>
              </div>

              <div className="my-2 border-t border-border/40" />
              <p className="text-xs font-bold text-orange-500 uppercase tracking-wider">Límites de Cosecha</p>

              <div className="grid grid-cols-3 gap-2">
                <div className="flex flex-col gap-1">
                  <Label htmlFor="effectiveArea" className="text-[10px] font-semibold text-muted-foreground truncate">Área Oper. Efectiva (m²)</Label>
                  <Input
                    id="effectiveArea"
                    type="number"
                    step="0.01"
                    placeholder="4500"
                    value={newPoolEffectiveArea}
                    onChange={(e) => setNewPoolEffectiveArea(e.target.value)}
                    className="text-xs h-8 rounded-lg"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <Label htmlFor="safeCapacity" className="text-[10px] font-semibold text-muted-foreground truncate">Cap. Oper. Seguridad (m³)</Label>
                  <Input
                    id="safeCapacity"
                    type="number"
                    step="0.1"
                    placeholder="5200"
                    value={newPoolSafeCapacity}
                    onChange={(e) => setNewPoolSafeCapacity(e.target.value)}
                    className="text-xs h-8 rounded-lg"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <Label htmlFor="maxCapacity" className="text-[10px] font-semibold text-muted-foreground truncate">Cap. Hidráulica Máx. (m³)</Label>
                  <Input
                    id="maxCapacity"
                    type="number"
                    step="0.1"
                    placeholder="6000"
                    value={newPoolMaxCapacity}
                    onChange={(e) => setNewPoolMaxCapacity(e.target.value)}
                    className="text-xs h-8 rounded-lg"
                  />
                </div>
              </div>
            </div>

            <ModalFooter className="mt-2">
              <ModalClose asChild>
                <Button type="button" variant="ghost" className="text-xs h-9 rounded-xl font-semibold">
                  Cancelar
                </Button>
              </ModalClose>
              <Button type="submit" className="text-xs h-9 rounded-xl font-bold bg-orange-600 hover:bg-orange-700 text-white">
                Guardar Vaso
              </Button>
            </ModalFooter>
          </form>
        </ModalContent>
      </Modal>

      {/* EDIT ELEMENT MODAL DIALOG */}
      <Modal open={isEditModalOpen} onOpenChange={setIsEditModalOpen}>
        <ModalContent className="max-w-md bg-card border border-border shadow-xl rounded-2xl p-6">
          <form onSubmit={handleUpdatePool} className="flex flex-col gap-4">
            <ModalHeader>
              <ModalTitle className="text-lg font-bold">Editar Vaso de Evaporación</ModalTitle>
              <ModalDescription className="text-xs text-muted-foreground">
                Modifique la información o límites del reservorio.
              </ModalDescription>
            </ModalHeader>

            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="editPoolCode" className="text-xs font-semibold">Código del Reservorio</Label>
                <Input
                  id="editPoolCode"
                  placeholder="Ej: R11"
                  value={editPoolCode}
                  onChange={(e) => setEditPoolCode(e.target.value)}
                  className="text-xs h-9 rounded-xl font-mono"
                  required
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="editPoolName" className="text-xs font-semibold">Nombre descriptivo</Label>
                <Input
                  id="editPoolName"
                  placeholder="Ej: Reservorio 11"
                  value={editPoolName}
                  onChange={(e) => setEditPoolName(e.target.value)}
                  className="text-xs h-9 rounded-xl"
                  required
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="editPoolCoords" className="text-xs font-semibold">Polígono básico delimitador (Opcional)</Label>
                <Input
                  id="editPoolCoords"
                  placeholder="Ej: [[-23.63, -68.32], [-23.64, -68.33], ...]"
                  value={editPoolCoords}
                  onChange={(e) => setEditPoolCoords(e.target.value)}
                  className="text-xs h-9 rounded-xl font-mono"
                />
                <span className="text-[10px] text-muted-foreground font-medium">
                  Matriz JSON de coordenadas [lat, lon].
                </span>
              </div>

              <div className="my-2 border-t border-border/40" />
              <p className="text-xs font-bold text-orange-500 uppercase tracking-wider">Límites de Cosecha</p>

              <div className="grid grid-cols-3 gap-2">
                <div className="flex flex-col gap-1">
                  <Label htmlFor="editEffectiveArea" className="text-[10px] font-semibold text-muted-foreground truncate">Área Oper. Efectiva (m²)</Label>
                  <Input
                    id="editEffectiveArea"
                    type="number"
                    step="0.01"
                    placeholder="5000"
                    value={editPoolEffectiveArea}
                    onChange={(e) => setEditPoolEffectiveArea(e.target.value)}
                    className="text-xs h-8 rounded-lg"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <Label htmlFor="editSafeCapacity" className="text-[10px] font-semibold text-muted-foreground truncate">Cap. Oper. Seguridad (m³)</Label>
                  <Input
                    id="editSafeCapacity"
                    type="number"
                    step="0.1"
                    placeholder="6000"
                    value={editPoolSafeCapacity}
                    onChange={(e) => setEditPoolSafeCapacity(e.target.value)}
                    className="text-xs h-8 rounded-lg"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <Label htmlFor="editMaxCapacity" className="text-[10px] font-semibold text-muted-foreground truncate">Cap. Hidráulica Máx. (m³)</Label>
                  <Input
                    id="editMaxCapacity"
                    type="number"
                    step="0.1"
                    placeholder="7000"
                    value={editPoolMaxCapacity}
                    onChange={(e) => setEditPoolMaxCapacity(e.target.value)}
                    className="text-xs h-8 rounded-lg"
                  />
                </div>
              </div>
            </div>

            <ModalFooter className="mt-2">
              <ModalClose asChild>
                <Button type="button" variant="ghost" className="text-xs h-9 rounded-xl font-semibold">
                  Cancelar
                </Button>
              </ModalClose>
              <Button type="submit" className="text-xs h-9 rounded-xl font-bold bg-orange-600 hover:bg-orange-700 text-white">
                Actualizar Vaso
              </Button>
            </ModalFooter>
          </form>
        </ModalContent>
      </Modal>
    </div>
  );
}
