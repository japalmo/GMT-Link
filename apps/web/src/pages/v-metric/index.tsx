import { useEffect, useRef, useState, useMemo, type ReactNode } from 'react';
import {
  Layers,
  Activity,
  Map as MapIcon,
  TrendingUp,
  Calendar,
  ChevronRight,
  Download,
  Database,
  AlertTriangle,
  CheckCircle2,
  User,
  RefreshCw,
  Sliders,
  AlertCircle,
  HelpCircle,
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
import {
  listProjects,
  listMetricPhases,
  listMetricVariables,
  listMetricElements,
  getMetricDataPoints,
  type MetricElement,
  type MetricPhase,
  type MetricVariable,
  type MetricDataPoint,
} from '@/lib/api';
import type { ProjectView, ServiceView } from '@/types/operations';

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
  const [projects, setProjects] = useState<ProjectView[]>([]);
  const [selectedProject, setSelectedProject] = useState<ProjectView | null>(null);
  const [selectedService, setSelectedService] = useState<ServiceView | null>(null);
  const [phases, setPhases] = useState<MetricPhase[]>([]);
  const [selectedPhase, setSelectedPhase] = useState<MetricPhase | null>(null);

  // Core Data States
  const [elements, setElements] = useState<MetricElement[]>([]);
  const [variables, setVariables] = useState<MetricVariable[]>([]);
  const [dataPoints, setDataPoints] = useState<MetricDataPoint[]>([]);

  // Selected pool/element state
  const [selectedElementId, setSelectedElementId] = useState<string | null>(null);

  // UI States
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
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
      setPhases([]);
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
        setPhases(data);
        if (data.length > 0) {
          const activePhase = data[0];
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
  useEffect(() => {
    if (!selectedProject || !selectedPhase) return;

    const fetchAllData = async () => {
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

        if (elData.length > 0) {
          setSelectedElementId(elData[0]?.id || null);
        } else {
          setSelectedElementId(null);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Error al cargar datos del proyecto');
      } finally {
        setLoading(false);
      }
    };

    void fetchAllData();
  }, [selectedProject, selectedPhase]);

  // Generate fallback polygons for Atacama pools (R1 to R10)
  const getDefaultPolygon = (code: string): [number, number][] => {
    const match = code.match(/\d+/);
    const num = match ? parseInt(match[0], 10) : 1;
    const row = Math.floor((num - 1) / 2); // 0..4
    const col = (num - 1) % 2; // 0..1

    // Scale coordinates to resemble real Atacama pond grids
    const baseLat = -23.520 - row * 0.005;
    const baseLng = -68.270 + col * 0.007;

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
  const latestPoolMetrics = useMemo(() => {
    const metrics: Record<string, Record<string, string>> = {};

    elements.forEach((el) => {
      metrics[el.id] = {};
    });

    // Sort chronologically ascending to overwrite with the latest values
    const sortedDps = [...dataPoints].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );

    sortedDps.forEach((dp) => {
      if (dp.elementId) {
        const elementMetrics = metrics[dp.elementId];
        if (elementMetrics) {
          const variable = variables.find((v) => v.id === dp.variableId);
          if (variable) {
            elementMetrics[variable.code] = dp.value;
          }
        }
      }
    });

    return metrics;
  }, [elements, variables, dataPoints]);

  // Compute pool alert status
  const getPoolStatus = (element: MetricElement) => {
    const poolData = latestPoolMetrics[element.id] || {};
    const cotaEspejoStr = poolData['cota_espejo'];

    if (!cotaEspejoStr) return 'neutral'; // No data

    const cotaEspejo = parseFloat(cotaEspejoStr);
    const metadata = (element.metadata as Record<string, number> | null) || {};
    const cotaCritica = metadata.cota_lamina_critica;
    const cotaSegura = metadata.cota_segura;

    if (isNaN(cotaEspejo)) return 'neutral';

    if (cotaCritica !== undefined && cotaEspejo >= cotaCritica) {
      return 'danger'; // Exceeds critical level
    }
    if (cotaSegura !== undefined && cotaEspejo >= cotaSegura) {
      return 'warning'; // Warning level
    }
    return 'safe'; // Normal
  };

  // Compute summary stats across all pools
  const summaryStats = useMemo(() => {
    let totalBrineVolume = 0;
    let totalFreeVolume = 0;
    let totalDecantedSalt = 0;

    elements.forEach((el) => {
      const elData = latestPoolMetrics[el.id] || {};
      const volSalmueraTotal = parseFloat(elData['vol_salmuera_total'] || '0');
      const volSalmueraLibre = parseFloat(elData['vol_salmuera_libre'] || '0');
      const volSal = parseFloat(elData['vol_sal'] || '0');

      if (!isNaN(volSalmueraTotal)) totalBrineVolume += volSalmueraTotal;
      if (!isNaN(volSalmueraLibre)) totalFreeVolume += volSalmueraLibre;
      if (!isNaN(volSal)) totalDecantedSalt += volSal;
    });

    return {
      totalBrineVolume,
      totalFreeVolume,
      totalDecantedSalt,
      poolCount: elements.length,
    };
  }, [elements, latestPoolMetrics]);

  // Selected element data
  const selectedElement = useMemo(() => {
    return elements.find((e) => e.id === selectedElementId) || null;
  }, [elements, selectedElementId]);

  // Timeline of metrics for the selected element
  const selectedElementTimeline = useMemo(() => {
    if (!selectedElementId) return [];

    const elDps = dataPoints.filter((dp) => dp.elementId === selectedElementId);

    // Group by timestamp/date
    const grouped: Record<string, { date: string; createdBy: string; timestamp: number; [key: string]: any }> = {};

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

  // Active element list sorted by alert status
  const sortedElements = useMemo(() => {
    return [...elements].sort((a, b) => {
      const statusA = getPoolStatus(a);
      const statusB = getPoolStatus(b);

      const score = { danger: 3, warning: 2, neutral: 1, safe: 0 };
      return score[statusB as keyof typeof score] - score[statusA as keyof typeof score];
    });
  }, [elements, latestPoolMetrics]);

  // Leaflet Map Initialization and Synchronization
  useEffect(() => {
    if (!LModule || loading || error || !mapContainerRef.current) return;

    // Destroy existing map if any
    if (mapRef.current) {
      mapRef.current.remove();
      mapRef.current = null;
      polygonsRef.current.clear();
    }

    // Centering coordinate helper (defaults to Atacama pond grid center)
    const initialCenter: [number, number] = [-23.535, -68.255];

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
  }, [LModule, loading, error]);

  // Sync Map layer type
  useEffect(() => {
    const map = mapRef.current;
    if (!LModule || !map) return;

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
  }, [LModule, mapType]);

  // Render/update Polygons on the Map
  useEffect(() => {
    const map = mapRef.current;
    if (!LModule || !map || elements.length === 0) return;

    // Clear existing polygons
    polygonsRef.current.forEach((polygon) => polygon.remove());
    polygonsRef.current.clear();

    const bounds = LModule.latLngBounds([]);

    elements.forEach((el) => {
      const coordinates = parsePolygon(el);
      coordinates.forEach((coord) => bounds.extend(coord));

      const status = getPoolStatus(el);
      const isSelected = el.id === selectedElementId;

      // Color mapping
      let fillColor = '#10b981'; // safe emerald
      let strokeColor = '#059669';

      if (status === 'danger') {
        fillColor = '#ef4444'; // red
        strokeColor = '#b91c1c';
      } else if (status === 'warning') {
        fillColor = '#f97316'; // orange/copper accent
        strokeColor = '#ea580c';
      } else if (status === 'neutral') {
        fillColor = '#94a3b8'; // slate/grey
        strokeColor = '#64748b';
      }

      const polygon = LModule.polygon(coordinates, {
        fillColor,
        fillOpacity: isSelected ? 0.65 : 0.35,
        color: isSelected ? '#ffffff' : strokeColor,
        weight: isSelected ? 3.5 : 1.8,
        dashArray: isSelected ? undefined : '3, 4',
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

  // Center map on selected element
  const centerOnElement = (el: MetricElement) => {
    const map = mapRef.current;
    if (!LModule || !map) return;

    const coordinates = parsePolygon(el);
    const bounds = LModule.latLngBounds(coordinates);
    if (bounds.isValid()) {
      map.fitBounds(bounds, { maxZoom: 15, padding: [40, 40] });
    }
  };

  // CSV Exporter
  const handleExportCSV = () => {
    if (!selectedElement || selectedElementTimeline.length === 0) return;

    let csvContent = 'data:text/csv;charset=utf-8,';
    csvContent += 'Fecha,Operador,Cota Espejo (m),Cota Sal (m),Volumen Total Salmuera (m3),Volumen Salmuera Libre (m3),Volumen Sal decantada (m3)\n';

    selectedElementTimeline.forEach((row) => {
      const cotaEsp = row['cota_espejo'] ?? '';
      const cotaSal = row['cota_sal'] ?? '';
      const volTot = row['vol_salmuera_total'] ?? '';
      const volLib = row['vol_salmuera_libre'] ?? '';
      const volS = row['vol_sal'] ?? '';

      csvContent += `"${row.date}","${row.createdBy}",${cotaEsp},${cotaSal},${volTot},${volLib},${volS}\n`;
    });

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `cubicaciones_${selectedElement.code}_${selectedPhase?.code}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Custom SVG Chart Components (Zero dependency, high styling compatibility)
  const renderVolumesChart = () => {
    const timeline = selectedElementTimeline;
    if (timeline.length < 2) {
      return (
        <div className="h-48 flex items-center justify-center text-xs text-muted-foreground border border-dashed border-border/80 rounded-xl bg-accent/5">
          Se requieren al menos 2 mediciones históricas para proyectar tendencias.
        </div>
      );
    }

    const width = 500;
    const height = 180;
    const padding = 35;

    // Find min and max values
    const allVals = timeline.flatMap((d) => [
      d['vol_salmuera_total'] || 0,
      d['vol_salmuera_libre'] || 0,
      d['vol_sal'] || 0,
    ]);
    const maxVal = Math.max(...allVals, 1000) * 1.1; // padding top
    const minVal = 0; // standard floor

    const getX = (index: number) => padding + (index / (timeline.length - 1)) * (width - 2 * padding);
    const getY = (val: number) => height - padding - ((val - minVal) / (maxVal - minVal)) * (height - 2 * padding);

    // Build SVG paths
    const buildPath = (key: string) => {
      return timeline
        .map((d, i) => {
          const val = d[key] || 0;
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
          <linearGradient id="gradTotal" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#f97316" stopOpacity="0.3" />
            <stop offset="100%" stopColor="#f97316" stopOpacity="0.0" />
          </linearGradient>
          <linearGradient id="gradLibre" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#06b6d4" stopOpacity="0.3" />
            <stop offset="100%" stopColor="#06b6d4" stopOpacity="0.0" />
          </linearGradient>
          <linearGradient id="gradSal" x1="0" y1="0" x2="0" y2="1">
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

        {/* X Axis dates (shows first and last date) */}
        <g className="opacity-70">
          <text x={padding} y={height - 10} textAnchor="start" className="fill-muted-foreground text-[8px] font-semibold">
            {timeline[0]?.date.split(' ')[0] || ''}
          </text>
          <text x={width - padding} y={height - 10} textAnchor="end" className="fill-muted-foreground text-[8px] font-semibold">
            {timeline[timeline.length - 1]?.date.split(' ')[0] || ''}
          </text>
        </g>

        {/* Areas */}
        <path d={buildAreaPath('vol_salmuera_total')} fill="url(#gradTotal)" />
        <path d={buildAreaPath('vol_salmuera_libre')} fill="url(#gradLibre)" />
        <path d={buildAreaPath('vol_sal')} fill="url(#gradSal)" />

        {/* Lines */}
        <path d={buildPath('vol_salmuera_total')} fill="none" stroke="#f97316" strokeWidth="2.2" />
        <path d={buildPath('vol_salmuera_libre')} fill="none" stroke="#06b6d4" strokeWidth="2.2" />
        <path d={buildPath('vol_sal')} fill="none" stroke="#eab308" strokeWidth="1.8" />

        {/* Interactive nodes */}
        {timeline.map((d, i) => {
          const cx = getX(i);
          const totY = getY(d['vol_salmuera_total'] || 0);
          return (
            <g key={i} className="group cursor-pointer">
              <circle cx={cx} cy={totY} r="3" className="fill-orange-500 hover:r-5 transition-all" />
              <title>{`Fecha: ${d.date}\nVol. Total: ${d['vol_salmuera_total']?.toLocaleString('es-CL')} m³\nVol. Libre: ${d['vol_salmuera_libre']?.toLocaleString('es-CL')} m³\nVol. Sal: ${d['vol_sal']?.toLocaleString('es-CL')} m³`}</title>
            </g>
          );
        })}
      </svg>
    );
  };

  const renderLevelsChart = () => {
    const timeline = selectedElementTimeline;
    if (timeline.length < 2) return null;

    const width = 500;
    const height = 180;
    const padding = 35;

    // Retrieve reference limits from Selected Pool Metadata
    const metadata = (selectedElement?.metadata as Record<string, number> | null) || {};
    const cotaCritica = metadata.cota_lamina_critica ?? 2302.2;
    const cotaSegura = metadata.cota_segura ?? 2301.8;
    const cotaFondo = metadata.cota_fondo ?? 2300.5;

    const allVals = timeline.flatMap((d) => [
      d['cota_espejo'] || 0,
      d['cota_sal'] || 0,
    ]).concat([cotaCritica, cotaSegura, cotaFondo]);

    const maxVal = Math.max(...allVals) + 0.1;
    const minVal = Math.min(...allVals) - 0.1;

    const getX = (index: number) => padding + (index / (timeline.length - 1)) * (width - 2 * padding);
    const getY = (val: number) => height - padding - ((val - minVal) / (maxVal - minVal)) * (height - 2 * padding);

    const buildPath = (key: string) => {
      return timeline
        .map((d, i) => {
          const val = d[key] || 0;
          return `${i === 0 ? 'M' : 'L'} ${getX(i)} ${getY(val)}`;
        })
        .join(' ');
    };

    return (
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-full text-foreground select-none">
        {/* Safe, Warning and Critical limits zones */}
        <rect
          x={padding}
          y={getY(maxVal)}
          width={width - 2 * padding}
          height={Math.max(0, getY(cotaCritica) - getY(maxVal))}
          className="fill-red-500/10"
        />
        <rect
          x={padding}
          y={getY(cotaCritica)}
          width={width - 2 * padding}
          height={Math.max(0, getY(cotaSegura) - getY(cotaCritica))}
          className="fill-orange-500/10"
        />
        <rect
          x={padding}
          y={getY(cotaSegura)}
          width={width - 2 * padding}
          height={Math.max(0, getY(cotaFondo) - getY(cotaSegura))}
          className="fill-emerald-500/10"
        />

        {/* Reference Level lines */}
        {[
          { val: cotaCritica, label: 'Lám. Crítica', color: '#ef4444' },
          { val: cotaSegura, label: 'Lím. Seguro', color: '#f97316' },
          { val: cotaFondo, label: 'Fondo Poza', color: '#64748b' },
        ].map((lim, idx) => {
          const y = getY(lim.val);
          return (
            <g key={idx} className="opacity-95">
              <line
                x1={padding}
                y1={y}
                x2={width - padding}
                y2={y}
                stroke={lim.color}
                strokeWidth="1"
                strokeDasharray="4, 3"
              />
              <text
                x={width - padding + 5}
                y={y + 3}
                textAnchor="start"
                fill={lim.color}
                className="font-bold text-[7px]"
              >
                {lim.label} ({lim.val.toFixed(2)}m)
              </text>
            </g>
          );
        })}

        {/* Y Axis ticks */}
        {[0, 0.5, 1].map((ratio, idx) => {
          const val = minVal + ratio * (maxVal - minVal);
          const y = getY(val);
          return (
            <g key={idx} className="opacity-40">
              <line x1={padding} y1={y} x2={width - padding} y2={y} stroke="currentColor" strokeWidth="0.5" />
              <text x={padding - 5} y={y + 3} textAnchor="end" className="fill-muted-foreground font-mono text-[9px]">
                {val.toFixed(2)}
              </text>
            </g>
          );
        })}

        {/* Lines */}
        <path d={buildPath('cota_espejo')} fill="none" stroke="#2563eb" strokeWidth="2.2" />
        <path d={buildPath('cota_sal')} fill="none" stroke="#78350f" strokeWidth="2" strokeDasharray="3, 2" />

        {/* Nodes */}
        {timeline.map((d, i) => {
          const cx = getX(i);
          const espY = getY(d['cota_espejo'] || 0);
          return (
            <g key={i} className="group cursor-pointer">
              <circle cx={cx} cy={espY} r="3" className="fill-blue-600 hover:r-5 transition-all" />
              <title>{`Fecha: ${d.date}\nCota Espejo: ${d['cota_espejo']?.toFixed(3)} m\nCota Sal: ${d['cota_sal']?.toFixed(3)} m`}</title>
            </g>
          );
        })}
      </svg>
    );
  };

  // Recent Uploads History List
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

    // Group dataPoints by unique createdAt and createdById
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
        otpVerified: true, // OTP verification is required at desktop submit
        cotaEspejo: metrics['cota_espejo'],
        volSalmuera: metrics['vol_salmuera_total'],
        volSal: metrics['vol_sal'],
      });
    });

    return list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 10);
  }, [dataPoints, elements, variables]);

  if (loading && projects.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[70vh] gap-3">
        <RefreshCw className="size-8 text-primary animate-spin" />
        <p className="text-sm font-semibold text-muted-foreground">Sincronizando con GMT Link...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 max-w-md mx-auto text-center px-4">
        <AlertTriangle className="size-12 text-destructive" />
        <h2 className="text-lg font-bold">Error de sincronización</h2>
        <p className="text-sm text-muted-foreground">{error}</p>
        <Button onClick={loadProjects} className="bg-primary text-primary-foreground font-bold">
          <RefreshCw className="size-4 mr-2" /> Reintentar
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 w-full max-w-7xl mx-auto px-4 py-6">
      {/* Top Filter Bar & Nav */}
      <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-card/45 backdrop-blur-md border border-border/60 rounded-2xl p-6 shadow-sm">
        <div className="flex items-center gap-4">
          <div className="bg-orange-500/10 border border-orange-500/25 size-12 rounded-xl flex items-center justify-center text-orange-500 shadow-inner">
            <Layers className="size-6 animate-pulse" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">V-Metric Dashboard</h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              Cubicación y monitoreo volumétrico de Pozas de Salmuera (Atacama)
            </p>
          </div>
        </div>

        {/* Project Selector Config */}
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
        {/* Left Side: Map and Pool List */}
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
              <div className="h-96 w-full relative z-0">
                <div ref={mapContainerRef} className="w-full h-full" />
              </div>
            </CardContent>
          </Card>

          {/* Quick Pool Selector List */}
          <Card className="border border-border/60 shadow-sm bg-card/45 backdrop-blur-md">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-bold">Catálogo de Vasos y Niveles</CardTitle>
            </CardHeader>
            <CardContent className="max-h-48 overflow-y-auto pr-2">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {sortedElements.map((el) => {
                  const status = getPoolStatus(el);
                  const isSelected = el.id === selectedElementId;
                  const metrics = latestPoolMetrics[el.id] || {};
                  const cotaEspejo = metrics['cota_espejo'] ? `${parseFloat(metrics['cota_espejo']).toFixed(2)} m` : 'S/D';

                  return (
                    <button
                      key={el.id}
                      onClick={() => {
                        setSelectedElementId(el.id);
                        centerOnElement(el);
                      }}
                      className={`flex items-center justify-between p-3 rounded-xl border text-left transition-all ${
                        isSelected
                          ? 'bg-orange-500/10 border-orange-500 text-foreground ring-1 ring-orange-500'
                          : 'border-border/60 hover:bg-accent/30 text-muted-foreground'
                      }`}
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
                          <p className="text-xs font-bold text-foreground">{el.name}</p>
                          <p className="text-[10px] font-mono">{el.code}</p>
                        </div>
                      </div>

                      <div className="text-right">
                        <p className="text-xs font-bold text-foreground">{cotaEspejo}</p>
                        <p className="text-[9px] text-muted-foreground">Cota Espejo</p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right Side: Selected Pool Metric details and Line Charts */}
        <div className="lg:col-span-5 flex flex-col gap-6">
          {selectedElement ? (
            <Card className="border border-border/60 shadow-md bg-card/50 backdrop-blur-md">
              <CardHeader className="pb-3 border-b border-border/60">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-lg font-bold flex items-center gap-2">
                      {selectedElement.name}
                      <Badge variant="outline" className="font-mono text-[10px] bg-accent/30 font-bold border-border">
                        {selectedElement.code}
                      </Badge>
                    </CardTitle>
                    <CardDescription className="text-xs">
                      Detalle métrico histórico y límites operacionales.
                    </CardDescription>
                  </div>

                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleExportCSV}
                    disabled={selectedElementTimeline.length === 0}
                    className="h-8 text-xs font-bold border-border/80 hover:bg-primary/5"
                  >
                    <Download className="size-3.5 mr-1" /> Exportar CSV
                  </Button>
                </div>
              </CardHeader>

              <CardContent className="pt-4 flex flex-col gap-6">
                {/* Reference Levels Metadata list */}
                <div>
                  <h4 className="text-xs font-semibold text-muted-foreground mb-2 flex items-center gap-1">
                    <Sliders className="size-3 text-orange-500" />
                    Límites de Referencia (Metadata Estática)
                  </h4>
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div className="p-2.5 rounded-xl border border-border/50 bg-red-500/5">
                      <p className="text-[9px] text-red-500 font-bold">Lám. Crítica</p>
                      <p className="text-sm font-black text-foreground mt-0.5">
                        {((selectedElement.metadata as Record<string, number> | null)?.cota_lamina_critica)?.toFixed(2) ?? 'S/R'} <span className="text-[10px] font-normal text-muted-foreground">m</span>
                      </p>
                    </div>
                    <div className="p-2.5 rounded-xl border border-border/50 bg-orange-500/5">
                      <p className="text-[9px] text-orange-500 font-bold">Lím. Seguro</p>
                      <p className="text-sm font-black text-foreground mt-0.5">
                        {((selectedElement.metadata as Record<string, number> | null)?.cota_segura)?.toFixed(2) ?? 'S/R'} <span className="text-[10px] font-normal text-muted-foreground">m</span>
                      </p>
                    </div>
                    <div className="p-2.5 rounded-xl border border-border/50 bg-slate-500/5">
                      <p className="text-[9px] text-muted-foreground font-bold">Fondo Estanque</p>
                      <p className="text-sm font-black text-foreground mt-0.5">
                        {((selectedElement.metadata as Record<string, number> | null)?.cota_fondo)?.toFixed(2) ?? 'S/R'} <span className="text-[10px] font-normal text-muted-foreground">m</span>
                      </p>
                    </div>
                  </div>
                </div>

                {/* SVG Charts */}
                <div className="flex flex-col gap-4">
                  <div>
                    <h4 className="text-xs font-semibold text-muted-foreground mb-2.5 flex items-center gap-1.5">
                      <TrendingUp className="size-3 text-orange-500" />
                      Histórico de Volúmenes (m³)
                    </h4>
                    <div className="bg-accent/10 border border-border/60 rounded-xl p-3 h-52">
                      {renderVolumesChart()}
                    </div>
                    {selectedElementTimeline.length >= 2 && (
                      <div className="flex items-center justify-center gap-4 text-[9px] font-bold mt-2">
                        <span className="flex items-center gap-1"><span className="size-2 rounded-full bg-orange-500" /> Vol. Total</span>
                        <span className="flex items-center gap-1"><span className="size-2 rounded-full bg-cyan-500" /> Vol. Libre</span>
                        <span className="flex items-center gap-1"><span className="size-2 rounded-full bg-yellow-500" /> Vol. Sal</span>
                      </div>
                    )}
                  </div>

                  <div>
                    <h4 className="text-xs font-semibold text-muted-foreground mb-2.5 flex items-center gap-1.5">
                      <Activity className="size-3 text-orange-500" />
                      Histórico de Altura / Espejo (m)
                    </h4>
                    <div className="bg-accent/10 border border-border/60 rounded-xl p-3 h-52">
                      {renderLevelsChart()}
                    </div>
                    {selectedElementTimeline.length >= 2 && (
                      <div className="flex items-center justify-center gap-4 text-[9px] font-bold mt-2">
                        <span className="flex items-center gap-1"><span className="size-2 rounded-full bg-blue-600" /> Cota Espejo</span>
                        <span className="flex items-center gap-1"><span className="size-2 rounded-full bg-amber-800" /> Cota Sal</span>
                      </div>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card className="border border-border/60 shadow-sm bg-card/65 h-96 flex flex-col items-center justify-center text-center p-6">
              <HelpCircle className="size-10 text-muted-foreground mb-3" />
              <h3 className="text-sm font-bold">Selecciona una Poza</h3>
              <p className="text-xs text-muted-foreground mt-1 max-w-[240px]">
                Haz clic en un estanque en el mapa o en el catálogo inferior para desplegar sus series históricas.
              </p>
            </Card>
          )}
        </div>
      </div>

      {/* Recent Uploads Table */}
      <section className="bg-card/45 backdrop-blur-md border border-border/60 rounded-2xl p-6 shadow-sm">
        <header className="mb-4 flex justify-between items-center">
          <div>
            <h2 className="text-md font-bold flex items-center gap-2">
              <CheckCircle2 className="size-4 text-emerald-500" />
              Historial Reciente de Cubicaciones Subidas
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
    </div>
  );
}
