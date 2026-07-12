import { useState, useEffect, useRef, type ReactNode } from 'react';
import {
  Navigation,
  Globe,
  Upload,
  Download,
  Sparkles,
  Loader2,
  HelpCircle,
  Eye,
  FileSpreadsheet,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert } from '@/components/ui/alert';
import { Tabs, type TabItem } from '@/components/ui/tabs';
import { PageContainer } from '@/components/layout/page-container';
import { PageHeader } from '@/components/layout/page-header';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  convertCoordinate,
  convertCoordinatesBulk,
  detectShorelineWithIA,
  getGeminiQuota,
  type ConvertPointInput,
  type ConvertPointResult,
} from '@/lib/api';

export default function GisToolsPage(): ReactNode {
  // Navigation Tabs
  const [activeSubTab, setActiveSubTab] = useState<'convert' | 'shoreline'>('convert');

  // Quota state
  const [quota, setQuota] = useState<{ used: number; remaining: number } | null>(null);

  // Single Point Conversion State
  const [direction, setDirection] = useState<'UTM_TO_LL' | 'LL_TO_UTM'>('LL_TO_UTM');
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const [east, setEast] = useState('');
  const [north, setNorth] = useState('');
  const [zone, setZone] = useState('19');
  const [isSouthern, setIsSouthern] = useState(true);
  const [singleResult, setSingleResult] = useState<ConvertPointResult | null>(null);
  const [singleLoading, setSingleLoading] = useState(false);

  // Bulk Conversion State
  const [bulkFile, setBulkFile] = useState<File | null>(null);
  const [bulkRows, setBulkRows] = useState<ConvertPointInput[]>([]);
  const [bulkResults, setBulkResults] = useState<ConvertPointResult[]>([]);
  const [bulkLoading, setBulkLoading] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);

  // Shoreline Detection State
  const [aerialFile, setAerialFile] = useState<File | null>(null);
  const [aerialPreviewUrl, setAerialPreviewUrl] = useState<string | null>(null);
  const [detectedPolygon, setDetectedPolygon] = useState<Array<{ x: number; y: number }>>([]);
  const [shoreLoading, setShoreLoading] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);

  // References
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Fetch Gemini daily quota
  const fetchQuota = async () => {
    try {
      const q = await getGeminiQuota();
      setQuota(q);
    } catch {
      // Quiet fail or placeholder
    }
  };

  useEffect(() => {
    void fetchQuota();
  }, []);

  // Drawing points/polygons on canvas plotter
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Colores derivados del tema activo (claro/oscuro) leyendo las variables CSS
    // del documento, para que texto, grilla y sombra se vean bien en ambos temas.
    const rootStyles = getComputedStyle(document.documentElement);
    const readVar = (name: string, fallback: string): string => {
      const value = rootStyles.getPropertyValue(name).trim();
      return value.length > 0 ? value : fallback;
    };
    const colorForeground = readVar('--foreground', '#e5e5e5');
    const colorMuted = readVar('--muted-foreground', '#888888');
    const colorGrid = readVar('--border', 'rgba(128,128,128,0.2)');
    const colorBackground = readVar('--background', '#000000');
    const colorMarker = readVar('--destructive', '#ef4444');

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Collect all active points to plot
    const points: Array<{ x: number; y: number; label?: string }> = [];

    if (bulkResults.length > 0) {
      bulkResults.forEach((pt, index) => {
        if (pt.latitude !== undefined && pt.longitude !== undefined) {
          points.push({ x: pt.longitude, y: pt.latitude, label: `P${index + 1}` });
        }
      });
    } else if (singleResult && singleResult.latitude !== undefined && singleResult.longitude !== undefined) {
      points.push({ x: singleResult.longitude, y: singleResult.latitude, label: 'Punto' });
    }

    if (points.length === 0) {
      // Draw grid placeholder
      ctx.strokeStyle = colorGrid;
      ctx.lineWidth = 1;
      for (let i = 20; i < canvas.width; i += 20) {
        ctx.beginPath();
        ctx.moveTo(i, 0);
        ctx.lineTo(i, canvas.height);
        ctx.stroke();
      }
      for (let j = 20; j < canvas.height; j += 20) {
        ctx.beginPath();
        ctx.moveTo(0, j);
        ctx.lineTo(canvas.width, j);
        ctx.stroke();
      }
      ctx.fillStyle = colorMuted;
      ctx.font = '10px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Ingresa coordenadas para visualizar el trazado en el plano', canvas.width / 2, canvas.height / 2);
      return;
    }

    // Determine bounding box
    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);

    const pad = 0.2; // Padding fraction
    const dx = maxX - minX || 0.01;
    const dy = maxY - minY || 0.01;

    const bounds = {
      minX: minX - dx * pad,
      maxX: maxX + dx * pad,
      minY: minY - dy * pad,
      maxY: maxY + dy * pad,
    };

    const toCanvasX = (val: number) => {
      const pct = (val - bounds.minX) / (bounds.maxX - bounds.minX);
      return pct * canvas.width;
    };

    const toCanvasY = (val: number) => {
      // Invert Y because canvas 0 is top and latitude 0 is bottom
      const pct = (val - bounds.minY) / (bounds.maxY - bounds.minY);
      return (1 - pct) * canvas.height;
    };

    // Draw coordinate axis/grid
    ctx.strokeStyle = colorGrid;
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 4]);

    // Draw Grid Lines relative to data
    const gridCount = 5;
    for (let i = 0; i <= gridCount; i++) {
      const ratio = i / gridCount;
      const latVal = bounds.minY + ratio * (bounds.maxY - bounds.minY);
      const lngVal = bounds.minX + ratio * (bounds.maxX - bounds.minX);

      const cx = toCanvasX(lngVal);
      const cy = toCanvasY(latVal);

      // Horizontal grid
      ctx.beginPath();
      ctx.moveTo(0, cy);
      ctx.lineTo(canvas.width, cy);
      ctx.stroke();

      // Vertical grid
      ctx.beginPath();
      ctx.moveTo(cx, 0);
      ctx.lineTo(cx, canvas.height);
      ctx.stroke();

      // Labels
      ctx.fillStyle = colorMuted;
      ctx.font = '9px monospace';
      ctx.setLineDash([]);
      ctx.fillText(lngVal.toFixed(4), cx + 2, canvas.height - 5);
      ctx.fillText(latVal.toFixed(4), 5, cy - 2);
      ctx.setLineDash([2, 4]);
    }
    ctx.setLineDash([]);

    // Draw connecting polygon line if there are multiple points
    if (points.length > 1) {
      ctx.beginPath();
      ctx.strokeStyle = 'rgba(99, 102, 241, 0.8)'; // Indigo neon
      ctx.lineWidth = 2.5;
      ctx.fillStyle = 'rgba(99, 102, 241, 0.15)';

      points.forEach((pt, index) => {
        const cx = toCanvasX(pt.x);
        const cy = toCanvasY(pt.y);
        if (index === 0) ctx.moveTo(cx, cy);
        else ctx.lineTo(cx, cy);
      });
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }

    // Draw individual nodes / points
    points.forEach((pt) => {
      const cx = toCanvasX(pt.x);
      const cy = toCanvasY(pt.y);

      // Outer glow ring
      ctx.beginPath();
      ctx.arc(cx, cy, 7, 0, 2 * Math.PI);
      ctx.fillStyle = 'rgba(239, 68, 68, 0.35)'; // Red dot glow
      ctx.fill();

      // Inner dot
      ctx.beginPath();
      ctx.arc(cx, cy, 3.5, 0, 2 * Math.PI);
      ctx.fillStyle = colorMarker;
      ctx.fill();

      // Node label
      if (pt.label) {
        ctx.fillStyle = colorForeground;
        ctx.font = 'bold 9px sans-serif';
        ctx.shadowColor = colorBackground;
        ctx.shadowBlur = 3;
        ctx.fillText(pt.label, cx + 8, cy - 4);
        ctx.shadowBlur = 0;
      }
    });
  }, [singleResult, bulkResults]);

  // Execute Single Conversion
  const handleSingleConvert = async (e: React.FormEvent) => {
    e.preventDefault();
    setSingleLoading(true);
    setGlobalError(null);
    try {
      const input: ConvertPointInput = { direction };
      if (direction === 'LL_TO_UTM') {
        const parsedLat = parseFloat(lat);
        const parsedLng = parseFloat(lng);
        if (isNaN(parsedLat) || isNaN(parsedLng)) {
          throw new Error('Latitud y Longitud deben ser números válidos.');
        }
        input.latitude = parsedLat;
        input.longitude = parsedLng;
      } else {
        const parsedEast = parseFloat(east);
        const parsedNorth = parseFloat(north);
        const parsedZone = parseInt(zone, 10);
        if (isNaN(parsedEast) || isNaN(parsedNorth) || isNaN(parsedZone)) {
          throw new Error('Easting, Northing y Huso deben ser números válidos.');
        }
        input.easting = parsedEast;
        input.northing = parsedNorth;
        input.zone = parsedZone;
        input.southernHemisphere = isSouthern;
      }

      const result = await convertCoordinate(input);
      setSingleResult(result);
    } catch (err) {
      setGlobalError(err instanceof Error ? err.message : 'Error al realizar conversión');
    } finally {
      setSingleLoading(false);
    }
  };

  // CSV parsing logic for Bulk Coordinates
  const parseBulkCsv = async (file: File) => {
    setBulkError(null);
    setBulkResults([]);
    try {
      const text = await file.text();
      const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
      if (lines.length === 0) {
        throw new Error('El archivo CSV está vacío.');
      }

      const headerLine = lines[0];
      if (!headerLine) throw new Error('No se pudo leer la cabecera del CSV.');
      const headers = headerLine.split(',').map((h) => h.trim().toLowerCase());
      const dirIdx = headers.indexOf('direction');
      const latIdx = headers.indexOf('latitude');
      const lngIdx = headers.indexOf('longitude');
      const eastIdx = headers.indexOf('easting');
      const northIdx = headers.indexOf('northing');
      const zoneIdx = headers.indexOf('zone');
      const southIdx = headers.indexOf('southernhemisphere');

      const points: ConvertPointInput[] = [];

      for (let i = 1; i < lines.length; i++) {
        const currentLine = lines[i];
        if (!currentLine) continue;
        const values = currentLine.split(',').map((v) => v.trim());
        if (values.length < headers.length) continue;

        const csvDir = dirIdx !== -1 ? (values[dirIdx] ?? 'LL_TO_UTM') : 'LL_TO_UTM';
        const finalDir = csvDir === 'UTM_TO_LL' ? 'UTM_TO_LL' : 'LL_TO_UTM';

        const pt: ConvertPointInput = { direction: finalDir };

        if (finalDir === 'LL_TO_UTM') {
          const rawLat = latIdx !== -1 ? parseFloat(values[latIdx] ?? '') : NaN;
          const rawLng = lngIdx !== -1 ? parseFloat(values[lngIdx] ?? '') : NaN;
          if (isNaN(rawLat) || isNaN(rawLng)) continue;
          pt.latitude = rawLat;
          pt.longitude = rawLng;
        } else {
          const rawEast = eastIdx !== -1 ? parseFloat(values[eastIdx] ?? '') : NaN;
          const rawNorth = northIdx !== -1 ? parseFloat(values[northIdx] ?? '') : NaN;
          const rawZone = zoneIdx !== -1 ? parseInt(values[zoneIdx] ?? '19', 10) : 19;
          const rawSouth = southIdx !== -1 ? (values[southIdx] ?? '').toLowerCase() === 'true' : true;
          if (isNaN(rawEast) || isNaN(rawNorth)) continue;
          pt.easting = rawEast;
          pt.northing = rawNorth;
          pt.zone = rawZone;
          pt.southernHemisphere = rawSouth;
        }

        points.push(pt);
      }

      if (points.length === 0) {
        throw new Error('No se encontraron coordenadas válidas para importar.');
      }

      setBulkRows(points);
    } catch (err) {
      setBulkError(err instanceof Error ? err.message : 'Error al parsear archivo de coordenadas');
    }
  };

  const handleBulkFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setBulkFile(file);
      void parseBulkCsv(file);
    }
  };

  // Convert Bulk Coordinates
  const handleBulkConvert = async () => {
    if (bulkRows.length === 0) return;
    setBulkLoading(true);
    setBulkError(null);
    try {
      const results = await convertCoordinatesBulk({ points: bulkRows });
      setBulkResults(results);
    } catch (err) {
      setBulkError(err instanceof Error ? err.message : 'Error al realizar conversión en lote');
    } finally {
      setBulkLoading(false);
    }
  };

  // Download converted bulk results as CSV
  const handleDownloadBulkResults = () => {
    if (bulkResults.length === 0) return;

    let csv = 'direction,latitude,longitude,easting,northing,zone,southernHemisphere\n';
    bulkResults.forEach((pt) => {
      csv += `${pt.direction},${pt.latitude ?? ''},${pt.longitude ?? ''},${pt.easting ?? ''},${pt.northing ?? ''},${pt.zone ?? ''},${pt.southernHemisphere ?? ''}\n`;
    });

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'coordenadas_procesadas.csv';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // Shoreline file selection
  const handleAerialFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setAerialFile(file);
      setDetectedPolygon([]);
      const url = URL.createObjectURL(file);
      setAerialPreviewUrl(url);
    }
  };

  // Detect Shoreline with Gemini REST call
  const handleDetectShoreline = async () => {
    if (!aerialFile) return;
    setShoreLoading(true);
    setGlobalError(null);
    try {
      // Convert file to base64
      const reader = new FileReader();
      const base64Promise = new Promise<string>((resolve, reject) => {
        reader.onload = (e) => resolve(e.target?.result as string);
        reader.onerror = (err) => reject(err);
      });
      reader.readAsDataURL(aerialFile);
      const fileDataUrl = await base64Promise;

      const res = await detectShorelineWithIA({ fileBase64: fileDataUrl });
      setDetectedPolygon(res.polygon);
      await fetchQuota();
    } catch (err) {
      setGlobalError(err instanceof Error ? err.message : 'Error al analizar la foto aérea');
    } finally {
      setShoreLoading(false);
    }
  };

  // SVG drawing of detected shoreline polygon
  const renderDetectedPolygonSvg = () => {
    if (detectedPolygon.length === 0) return null;
    const pointsString = detectedPolygon.map((p) => `${p.x}%,${p.y}%`).join(' ');
    return (
      <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 100 100" preserveAspectRatio="none">
        {/* Polygon Area Fill */}
        <polygon
          points={pointsString}
          className="fill-cyan-500/10 stroke-cyan-400 stroke-[0.8] animate-pulse"
          style={{ strokeDasharray: '2 1' }}
        />
        {/* Glow Nodes */}
        {detectedPolygon.map((p, idx) => (
          <circle
            key={idx}
            cx={`${p.x}%`}
            cy={`${p.y}%`}
            r="1.2%"
            className="fill-cyan-400 stroke-cyan-200 stroke-[0.3]"
          />
        ))}
      </svg>
    );
  };

  const tabItems: TabItem<'convert' | 'shoreline'>[] = [
    { value: 'convert', label: 'Transformación de Coordenadas', icon: Globe },
    { value: 'shoreline', label: 'Detección de Orillas (Gemini IA)', icon: Sparkles },
  ];

  return (
    <PageContainer maxWidth="7xl">
      {/* Page Header */}
      <PageHeader
        title="Herramientas Técnicas GIS"
        description="Módulo de transformación de coordenadas geográficas e inteligencia artificial para análisis topográfico."
        actions={
          quota && (
            <div className="flex items-center gap-2 bg-indigo-500/10 border border-indigo-500/20 rounded-xl px-4 py-2 text-xs">
              <Sparkles className="size-4 text-indigo-500 animate-pulse" />
              <div>
                <span className="text-muted-foreground font-semibold">Consultas IA diarias: </span>
                <Badge variant="outline" className="font-bold border-indigo-500/35 text-indigo-500 bg-indigo-500/5 ml-1">
                  {quota.remaining} restantes
                </Badge>
              </div>
            </div>
          )
        }
      />

      {globalError && (
        <Alert variant="destructive" live>
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1">
              <p className="font-semibold">Error técnico detectado</p>
              <p className="mt-1">{globalError}</p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setGlobalError(null)} className="h-auto p-1">
              Descartar
            </Button>
          </div>
        </Alert>
      )}

      {/* Tabs */}
      <Tabs<'convert' | 'shoreline'>
        aria-label="Herramientas GIS"
        items={tabItems}
        value={activeSubTab}
        onValueChange={setActiveSubTab}
      />

      {/* Tab Content */}
      <div className="mt-2">
        {activeSubTab === 'convert' ? (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Formulars Left */}
            <div className="lg:col-span-1 flex flex-col gap-6">
              {/* Single Point */}
              <Card className="border border-border/60 shadow-sm bg-card/60">
                <CardHeader>
                  <CardTitle className="text-md font-bold flex items-center gap-2">
                    <Navigation className="size-4 text-primary" />
                    Conversor Puntual
                  </CardTitle>
                  <CardDescription>
                    Puntos geográficos individuales con el modelo elipsoidal WGS84.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <form onSubmit={handleSingleConvert} className="flex flex-col gap-4">
                    <div className="flex flex-col gap-1.5">
                      <Label className="text-xs">Dirección de Conversión</Label>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setDirection('LL_TO_UTM');
                            setSingleResult(null);
                          }}
                          className={`py-2 text-[11px] font-bold rounded-lg border transition-all ${
                            direction === 'LL_TO_UTM'
                              ? 'bg-primary/10 text-primary border-primary/30'
                              : 'border-border/60 hover:bg-muted/30 text-muted-foreground'
                          }`}
                        >
                          Lat/Long ➔ UTM
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setDirection('UTM_TO_LL');
                            setSingleResult(null);
                          }}
                          className={`py-2 text-[11px] font-bold rounded-lg border transition-all ${
                            direction === 'UTM_TO_LL'
                              ? 'bg-primary/10 text-primary border-primary/30'
                              : 'border-border/60 hover:bg-muted/30 text-muted-foreground'
                          }`}
                        >
                          UTM ➔ Lat/Long
                        </button>
                      </div>
                    </div>

                    {direction === 'LL_TO_UTM' ? (
                      <>
                        <div className="flex flex-col gap-1">
                          <Label htmlFor="lat" className="text-xs">Latitud *</Label>
                          <Input
                            id="lat"
                            placeholder="Ej: -33.4569"
                            value={lat}
                            onChange={(e) => setLat(e.target.value)}
                            className="text-xs"
                            required
                          />
                        </div>
                        <div className="flex flex-col gap-1">
                          <Label htmlFor="lng" className="text-xs">Longitud *</Label>
                          <Input
                            id="lng"
                            placeholder="Ej: -70.6483"
                            value={lng}
                            onChange={(e) => setLng(e.target.value)}
                            className="text-xs"
                            required
                          />
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="flex flex-col gap-1">
                          <Label htmlFor="east" className="text-xs">Easting (X) *</Label>
                          <Input
                            id="east"
                            placeholder="Ej: 346800.5"
                            value={east}
                            onChange={(e) => setEast(e.target.value)}
                            className="text-xs font-mono"
                            required
                          />
                        </div>
                        <div className="flex flex-col gap-1">
                          <Label htmlFor="north" className="text-xs">Northing (Y) *</Label>
                          <Input
                            id="north"
                            placeholder="Ej: 6296000.2"
                            value={north}
                            onChange={(e) => setNorth(e.target.value)}
                            className="text-xs font-mono"
                            required
                          />
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div className="flex flex-col gap-1">
                            <Label htmlFor="zone" className="text-xs">Huso / Zona (1-60)</Label>
                            <Input
                              id="zone"
                              type="number"
                              min={1}
                              max={60}
                              value={zone}
                              onChange={(e) => setZone(e.target.value)}
                              className="text-xs font-mono"
                              required
                            />
                          </div>
                          <div className="flex flex-col justify-end pb-1">
                            <label className="flex items-center gap-2 cursor-pointer text-xs select-none">
                              <input
                                type="checkbox"
                                checked={isSouthern}
                                onChange={(e) => setIsSouthern(e.target.checked)}
                                className="rounded border-border/80 text-primary focus:ring-primary h-3.5 w-3.5"
                              />
                              Hemisferio Sur
                            </label>
                          </div>
                        </div>
                      </>
                    )}

                    <Button type="submit" disabled={singleLoading} className="w-full text-xs font-bold bg-primary text-primary-foreground mt-2">
                      {singleLoading ? (
                        <>
                          <Loader2 className="size-3 animate-spin mr-1.5" /> Convertiendo...
                        </>
                      ) : (
                        'Convertir Coordenada'
                      )}
                    </Button>
                  </form>

                  {/* Render Single result details */}
                  {singleResult && (
                    <div className="border border-primary/20 bg-primary/5 rounded-lg p-4 mt-4 flex flex-col gap-2.5">
                      <p className="text-[10px] font-bold text-primary uppercase tracking-wider">Resultado Proyección</p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs font-mono">
                        <div className="flex flex-col">
                          <span className="text-[10px] text-muted-foreground">Latitud</span>
                          <span className="font-semibold">{singleResult.latitude?.toFixed(7) ?? '—'}</span>
                        </div>
                        <div className="flex flex-col">
                          <span className="text-[10px] text-muted-foreground">Longitud</span>
                          <span className="font-semibold">{singleResult.longitude?.toFixed(7) ?? '—'}</span>
                        </div>
                        <div className="flex flex-col">
                          <span className="text-[10px] text-muted-foreground">Easting (X)</span>
                          <span className="font-semibold">{singleResult.easting?.toFixed(2) ?? '—'} m</span>
                        </div>
                        <div className="flex flex-col">
                          <span className="text-[10px] text-muted-foreground">Northing (Y)</span>
                          <span className="font-semibold">{singleResult.northing?.toFixed(2) ?? '—'} m</span>
                        </div>
                        <div className="flex flex-col">
                          <span className="text-[10px] text-muted-foreground">Huso / Zona</span>
                          <span className="font-semibold">{singleResult.zone ?? '—'}</span>
                        </div>
                        <div className="flex flex-col">
                          <span className="text-[10px] text-muted-foreground">Hemisferio</span>
                          <span className="font-semibold">{singleResult.southernHemisphere ? 'Sur (S)' : 'Norte (N)'}</span>
                        </div>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Bulk coordinate upload */}
              <Card className="border border-border/60 shadow-sm bg-card/60">
                <CardHeader>
                  <CardTitle className="text-md font-bold flex items-center gap-2">
                    <FileSpreadsheet className="size-4 text-primary" />
                    Conversor en Lote (CSV)
                  </CardTitle>
                  <CardDescription>
                    Carga lotes de vértices o polígonos completos mediante un archivo CSV estructurado.
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-4">
                  {bulkError && (
                    <Alert variant="destructive" live className="text-xs">
                      {bulkError}
                    </Alert>
                  )}

                  <div className="flex flex-col gap-2">
                    <label
                      htmlFor="bulkFile"
                      className="border-2 border-dashed border-border/70 hover:border-border/100 rounded-lg p-6 text-center cursor-pointer flex flex-col items-center gap-2 transition-colors"
                    >
                      <Upload className="size-6 text-muted-foreground" />
                      <span className="text-xs font-semibold">Seleccionar archivo CSV</span>
                      <span className="text-[10px] text-muted-foreground/80">
                        Debe tener cabeceras: direction, latitude, longitude, easting, northing, zone, southernHemisphere
                      </span>
                      <input
                        type="file"
                        id="bulkFile"
                        accept=".csv"
                        className="sr-only"
                        onChange={handleBulkFileChange}
                      />
                    </label>

                    {bulkFile && (
                      <div className="p-2 border rounded bg-muted/20 flex items-center justify-between text-xs">
                        <span className="font-semibold truncate max-w-[150px]">{bulkFile.name}</span>
                        <Badge variant="secondary">{bulkRows.length} puntos cargados</Badge>
                      </div>
                    )}
                  </div>

                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      onClick={() => {
                        const templateCsv = 'direction,latitude,longitude,easting,northing,zone,southernHemisphere\nLL_TO_UTM,-33.4569,-70.6483,,,,\nUTM_TO_LL,,,346800,6296000,19,true\n';
                        const blob = new Blob([templateCsv], { type: 'text/csv;charset=utf-8;' });
                        const url = URL.createObjectURL(blob);
                        const link = document.createElement('a');
                        link.href = url;
                        link.download = 'plantilla_coordenadas.csv';
                        document.body.appendChild(link);
                        link.click();
                        document.body.removeChild(link);
                        URL.revokeObjectURL(url);
                      }}
                      className="text-xs h-9 flex-1"
                    >
                      <Download className="size-3.5 mr-1" /> Plantilla CSV
                    </Button>
                    <Button
                      disabled={bulkRows.length === 0 || bulkLoading}
                      onClick={handleBulkConvert}
                      className="text-xs h-9 flex-1 bg-primary text-primary-foreground"
                    >
                      {bulkLoading ? (
                        <>
                          <Loader2 className="size-3.5 animate-spin mr-1.5" /> Procesando...
                        </>
                      ) : (
                        'Convertir Lote'
                      )}
                    </Button>
                  </div>

                  {bulkResults.length > 0 && (
                    <Button
                      onClick={handleDownloadBulkResults}
                      className="w-full text-xs bg-emerald-600 hover:bg-emerald-700 text-white font-bold"
                    >
                      <Download className="size-4 mr-1.5" /> Descargar CSV Procesado
                    </Button>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Plotter Grid Canvas right */}
            <div className="lg:col-span-2 flex flex-col gap-4">
              <Card className="border border-border/60 shadow-sm bg-card/60 h-full flex flex-col">
                <CardHeader className="pb-2">
                  <CardTitle className="text-md font-bold flex items-center gap-2">
                    <Eye className="size-4 text-primary" />
                    Graficador Bidimensional (Plano Cartesiano WGS84)
                  </CardTitle>
                  <CardDescription>
                    Visualizador de proyección geográfica en tiempo real para verificar los polígonos.
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex-1 flex items-center justify-center p-6 min-h-[300px]">
                  <div className="border border-border/80 rounded-xl overflow-hidden bg-background/55 relative shadow-inner p-1 w-full flex items-center justify-center">
                    <canvas
                      ref={canvasRef}
                      width={500}
                      height={400}
                      className="max-w-full aspect-[5/4] bg-background/80"
                    />
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        ) : (
          /* Shoreline AI detection section */
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Photo Uploader */}
            <div className="lg:col-span-1 flex flex-col gap-6">
              <Card className="border border-border/60 shadow-sm bg-card/60">
                <CardHeader>
                  <CardTitle className="text-md font-bold flex items-center gap-2">
                    <Upload className="size-4 text-primary" />
                    Subir Ortofoto / Foto Aérea
                  </CardTitle>
                  <CardDescription>
                    Sube una foto satelital o aérea en formato JPG, PNG o JPEG para identificar la orilla.
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-4">
                  <div className="flex flex-col gap-2">
                    <label
                      htmlFor="aerialFile"
                      className="border-2 border-dashed border-border/70 hover:border-border/100 rounded-lg p-8 text-center cursor-pointer flex flex-col items-center gap-3 transition-colors bg-muted/10 focus-within:ring-2 focus-within:ring-primary/40"
                    >
                      <Upload className="size-8 text-muted-foreground/80" />
                      <span className="text-xs font-semibold">Seleccionar Ortofoto</span>
                      <span className="text-[10px] text-muted-foreground/60">Tamaño máximo recomendado: 4MB</span>
                      <input
                        type="file"
                        id="aerialFile"
                        accept="image/*"
                        className="sr-only"
                        onChange={handleAerialFileChange}
                        ref={fileInputRef}
                      />
                    </label>
                  </div>

                  {aerialFile && (
                    <div className="p-3 border rounded-lg bg-muted/20 flex flex-col gap-2">
                      <div className="flex justify-between items-center text-xs">
                        <span className="font-semibold truncate max-w-[160px]">{aerialFile.name}</span>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setAerialFile(null);
                            setAerialPreviewUrl(null);
                            setDetectedPolygon([]);
                            if (fileInputRef.current) fileInputRef.current.value = '';
                          }}
                          className="h-auto p-1 text-muted-foreground hover:text-foreground"
                        >
                          Quitar
                        </Button>
                      </div>
                    </div>
                  )}

                  <Button
                    disabled={!aerialFile || shoreLoading || (quota !== null && quota.remaining === 0)}
                    onClick={handleDetectShoreline}
                    className="w-full text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white flex items-center justify-center gap-2 mt-2 py-2"
                  >
                    {shoreLoading ? (
                      <>
                        <Loader2 className="size-4 animate-spin" /> Escaneando contorno...
                      </>
                    ) : (
                      <>
                        <Sparkles className="size-4 text-white animate-pulse" />
                        Detectar Orilla con Gemini IA
                      </>
                    )}
                  </Button>
                </CardContent>
              </Card>

              {/* Help instructions */}
              <Card className="border border-border/60 shadow-sm bg-card/60">
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs font-semibold flex items-center gap-1.5 text-muted-foreground uppercase tracking-wider">
                    <HelpCircle className="size-4 text-primary" />
                    Instrucciones de Uso
                  </CardTitle>
                </CardHeader>
                <CardContent className="text-[11px] text-muted-foreground/90 flex flex-col gap-2">
                  <p>1. Carga una ortofoto de alta resolución donde la masa de agua sea claramente distinguible.</p>
                  <p>2. Presiona el botón de detección con IA. Gemini procesará la imagen e identificará los puntos limítrofes.</p>
                  <p>3. El polígono generado se proyectará como un overlay animado sobre tu ortofoto.</p>
                  <p className="font-semibold text-amber-500/95">Nota: Para evitar abusos de la API, cada operador cuenta con una cuota estricta de 3 solicitudes diarias.</p>
                </CardContent>
              </Card>
            </div>

            {/* Display Orthophoto with SVG Overlay */}
            <div className="lg:col-span-2">
              <Card className="border border-border/60 shadow-sm bg-card/60 h-full flex flex-col">
                <CardHeader>
                  <CardTitle className="text-md font-bold flex items-center gap-2">
                    <Eye className="size-4 text-primary" />
                    Visualizador de Detección de Orilla
                  </CardTitle>
                  <CardDescription>
                    Imagen aérea cargada con la proyección del polígono límite generado por la IA.
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex-1 flex items-center justify-center p-6 min-h-[350px]">
                  {aerialPreviewUrl ? (
                    <div className="relative border border-border/80 rounded-xl overflow-hidden bg-background max-w-full shadow-lg max-h-[500px]">
                      <img
                        src={aerialPreviewUrl}
                        alt="Aerial preview"
                        className="max-w-full max-h-[500px] object-contain block"
                      />
                      {renderDetectedPolygonSvg()}

                      {shoreLoading && (
                        <div className="absolute inset-0 bg-black/60 backdrop-blur-sm flex flex-col items-center justify-center text-white">
                          <Loader2 className="size-10 animate-spin text-indigo-400" />
                          <span className="text-sm font-semibold mt-4 tracking-wide">Analizando imagen y delimitando orilla...</span>
                          <span className="text-xs text-muted-foreground mt-1">Llamando al modelo multimodal Gemini-1.5-Flash</span>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="border border-dashed rounded-lg border-border/60 p-20 text-center max-w-md w-full">
                      <Globe className="size-12 text-muted-foreground/30 mx-auto" />
                      <p className="text-sm font-semibold text-muted-foreground/80 mt-3">Visualizador Inactivo</p>
                      <p className="text-xs text-muted-foreground mt-1">Carga una foto aérea en la sección lateral izquierda para activarlo.</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        )}
      </div>
    </PageContainer>
  );
}
