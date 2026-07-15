import { useId, useMemo, useState, type ReactNode } from 'react';
import {
  Navigation,
  Upload,
  Download,
  Loader2,
  FileSpreadsheet,
  Map as MapIcon,
  ExternalLink,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert } from '@/components/ui/alert';
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
import { GisMap, type GisMapPoint } from '@/components/maps/gis-map';
import {
  convertCoordinate,
  convertCoordinatesBulk,
  type ConvertPointInput,
  type ConvertPointResult,
} from '@/lib/api';

/** URL de Google Earth Web apuntando a un punto (vista a ~2 km de altura). */
function googleEarthUrl(lat: number, lng: number): string {
  return `https://earth.google.com/web/@${lat},${lng},0a,2000d,35y,0h,0t,0r`;
}

function openInGoogleEarth(lat: number, lng: number): void {
  window.open(googleEarthUrl(lat, lng), '_blank', 'noopener,noreferrer');
}

/** Escape mínimo para los nombres de Placemark en el KML. */
function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** KML con un Placemark por punto (coordinates = lng,lat,0), apto para
 * Google Earth Pro / Web. */
function buildKml(points: GisMapPoint[]): string {
  const placemarks = points
    .map((point, index) => {
      const name = escapeXml(point.label ?? `Punto ${index + 1}`);
      return [
        '    <Placemark>',
        `      <name>${name}</name>`,
        '      <Point>',
        `        <coordinates>${point.lng},${point.lat},0</coordinates>`,
        '      </Point>',
        '    </Placemark>',
      ].join('\n');
    })
    .join('\n');

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<kml xmlns="http://www.opengis.net/kml/2.2">',
    '  <Document>',
    '    <name>GMT Link - Puntos convertidos</name>',
    placemarks,
    '  </Document>',
    '</kml>',
    '',
  ].join('\n');
}

/** Genera el KML client-side y lo descarga como gis-puntos.kml. */
function downloadKml(points: GisMapPoint[]): void {
  if (points.length === 0) return;
  const blob = new Blob([buildKml(points)], {
    type: 'application/vnd.google-earth.kml+xml;charset=utf-8;',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'gis-puntos.kml';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export default function GisToolsPage(): ReactNode {
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
  // Filas del CSV descartadas al parsear (número de fila + motivo): el usuario
  // debe saber qué parte de su lote no se cargó.
  const [bulkSkipped, setBulkSkipped] = useState<Array<{ line: number; reason: string }>>([]);

  const [globalError, setGlobalError] = useState<string | null>(null);

  const directionLabelId = useId();

  // Puntos (WGS84) que alimentan el mini GIS: el lote tiene prioridad sobre
  // el resultado puntual, igual que el graficador anterior. Memoizado para que
  // la identidad del array solo cambie con los RESULTADOS: sin useMemo, cada
  // tecleo del formulario re-crearía el array y GisMap re-centraría el mapa.
  const mapPoints = useMemo<GisMapPoint[]>(() => {
    const points: GisMapPoint[] = [];
    if (bulkResults.length > 0) {
      bulkResults.forEach((pt, index) => {
        if (pt.latitude !== undefined && pt.longitude !== undefined) {
          points.push({ lat: pt.latitude, lng: pt.longitude, label: `P${index + 1}` });
        }
      });
    } else if (
      singleResult &&
      singleResult.latitude !== undefined &&
      singleResult.longitude !== undefined
    ) {
      points.push({ lat: singleResult.latitude, lng: singleResult.longitude, label: 'Punto' });
    }
    return points;
  }, [bulkResults, singleResult]);

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
          throw new Error('La latitud y la longitud deben ser números válidos.');
        }
        input.latitude = parsedLat;
        input.longitude = parsedLng;
      } else {
        const parsedEast = parseFloat(east);
        const parsedNorth = parseFloat(north);
        const parsedZone = parseInt(zone, 10);
        if (isNaN(parsedEast) || isNaN(parsedNorth) || isNaN(parsedZone)) {
          throw new Error('Easting, northing y huso deben ser números válidos.');
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
    setBulkSkipped([]);
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
      // Las filas inválidas NO se descartan en silencio: se acumulan con su
      // número de fila y el motivo para avisarle al usuario qué se omitió.
      const skipped: Array<{ line: number; reason: string }> = [];

      for (let i = 1; i < lines.length; i++) {
        const currentLine = lines[i];
        if (!currentLine) continue;
        const values = currentLine.split(',').map((v) => v.trim());
        if (values.length < headers.length) {
          skipped.push({ line: i + 1, reason: 'columnas insuficientes' });
          continue;
        }

        const csvDir = dirIdx !== -1 ? (values[dirIdx] ?? 'LL_TO_UTM') : 'LL_TO_UTM';
        const finalDir = csvDir === 'UTM_TO_LL' ? 'UTM_TO_LL' : 'LL_TO_UTM';

        const pt: ConvertPointInput = { direction: finalDir };

        if (finalDir === 'LL_TO_UTM') {
          const rawLat = latIdx !== -1 ? parseFloat(values[latIdx] ?? '') : NaN;
          const rawLng = lngIdx !== -1 ? parseFloat(values[lngIdx] ?? '') : NaN;
          if (isNaN(rawLat) || isNaN(rawLng)) {
            skipped.push({ line: i + 1, reason: 'latitud/longitud no numérica' });
            continue;
          }
          pt.latitude = rawLat;
          pt.longitude = rawLng;
        } else {
          const rawEast = eastIdx !== -1 ? parseFloat(values[eastIdx] ?? '') : NaN;
          const rawNorth = northIdx !== -1 ? parseFloat(values[northIdx] ?? '') : NaN;
          const rawZone = zoneIdx !== -1 ? parseInt(values[zoneIdx] ?? '19', 10) : 19;
          const rawSouth = southIdx !== -1 ? (values[southIdx] ?? '').toLowerCase() === 'true' : true;
          if (isNaN(rawEast) || isNaN(rawNorth)) {
            skipped.push({ line: i + 1, reason: 'easting/northing no numérico' });
            continue;
          }
          pt.easting = rawEast;
          pt.northing = rawNorth;
          pt.zone = rawZone;
          pt.southernHemisphere = rawSouth;
        }

        points.push(pt);
      }

      setBulkSkipped(skipped);

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

  return (
    <PageContainer maxWidth="7xl">
      {/* Page Header */}
      <PageHeader
        title="Transformación de coordenadas"
        description="Convierte coordenadas entre UTM y latitud/longitud (WGS84) y analízalas en un mini GIS con capas satelitales, topográficas y comparativas en el tiempo."
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

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Formulars Left */}
        <div className="lg:col-span-1 flex flex-col gap-6">
          {/* Single Point */}
          <Card className="border border-border/60 shadow-sm bg-card/60">
            <CardHeader>
              <CardTitle className="text-md font-bold flex items-center gap-2">
                <Navigation className="size-4 text-primary" />
                Conversor puntual
              </CardTitle>
              <CardDescription>
                Puntos geográficos individuales con el modelo elipsoidal WGS84.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSingleConvert} className="flex flex-col gap-4">
                <div className="flex flex-col gap-1.5">
                  {/* No es un <label>: etiqueta a un GRUPO de botones, no a un
                      control único (un label no puede etiquetar dos <button>). */}
                  <span
                    id={directionLabelId}
                    className="text-xs font-medium leading-none text-foreground select-none"
                  >
                    Dirección de conversión
                  </span>
                  <div
                    role="group"
                    aria-labelledby={directionLabelId}
                    className="grid grid-cols-1 sm:grid-cols-2 gap-2"
                  >
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
                      <Loader2 className="size-3 animate-spin mr-1.5" /> Convertiendo…
                    </>
                  ) : (
                    'Convertir coordenada'
                  )}
                </Button>
              </form>

              {/* Render Single result details */}
              {singleResult && (
                <div className="border border-primary/20 bg-primary/5 rounded-lg p-4 mt-4 flex flex-col gap-2.5">
                  <p className="text-[10px] font-bold text-primary uppercase tracking-wider">Resultado de la proyección</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs font-mono">
                    <div className="flex flex-col">
                      <span className="text-[10px] text-muted-foreground">Latitud</span>
                      <span className="font-semibold">{singleResult.latitude?.toFixed(7) ?? '-'}</span>
                    </div>
                    <div className="flex flex-col">
                      <span className="text-[10px] text-muted-foreground">Longitud</span>
                      <span className="font-semibold">{singleResult.longitude?.toFixed(7) ?? '-'}</span>
                    </div>
                    <div className="flex flex-col">
                      <span className="text-[10px] text-muted-foreground">Easting (X)</span>
                      <span className="font-semibold">{singleResult.easting?.toFixed(2) ?? '-'} m</span>
                    </div>
                    <div className="flex flex-col">
                      <span className="text-[10px] text-muted-foreground">Northing (Y)</span>
                      <span className="font-semibold">{singleResult.northing?.toFixed(2) ?? '-'} m</span>
                    </div>
                    <div className="flex flex-col">
                      <span className="text-[10px] text-muted-foreground">Huso / Zona</span>
                      <span className="font-semibold">{singleResult.zone ?? '-'}</span>
                    </div>
                    <div className="flex flex-col">
                      <span className="text-[10px] text-muted-foreground">Hemisferio</span>
                      <span className="font-semibold">{singleResult.southernHemisphere ? 'Sur (S)' : 'Norte (N)'}</span>
                    </div>
                  </div>
                  {singleResult.latitude !== undefined && singleResult.longitude !== undefined && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        if (singleResult.latitude !== undefined && singleResult.longitude !== undefined) {
                          openInGoogleEarth(singleResult.latitude, singleResult.longitude);
                        }
                      }}
                      className="w-full text-xs mt-1"
                    >
                      <ExternalLink className="size-3.5 mr-1" /> Abrir en Google Earth
                    </Button>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Bulk coordinate upload */}
          <Card className="border border-border/60 shadow-sm bg-card/60">
            <CardHeader>
              <CardTitle className="text-md font-bold flex items-center gap-2">
                <FileSpreadsheet className="size-4 text-primary" />
                Conversor en lote (CSV)
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

                {bulkSkipped.length > 0 && (
                  <Alert variant="warning" live className="text-xs">
                    Se cargaron {bulkRows.length} de {bulkRows.length + bulkSkipped.length} filas
                    del archivo. Filas omitidas:{' '}
                    {bulkSkipped.map((s) => `fila ${s.line} (${s.reason})`).join(', ')}. Corrige el
                    CSV y vuelve a cargarlo si las necesitas.
                  </Alert>
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
                      <Loader2 className="size-3.5 animate-spin mr-1.5" /> Procesando…
                    </>
                  ) : (
                    'Convertir lote'
                  )}
                </Button>
              </div>

              {bulkResults.length > 0 && (
                <Button
                  onClick={handleDownloadBulkResults}
                  className="w-full text-xs bg-emerald-600 hover:bg-emerald-700 text-white font-bold"
                >
                  <Download className="size-4 mr-1.5" /> Descargar CSV procesado
                </Button>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Mini GIS right */}
        <div className="lg:col-span-2 flex flex-col gap-6">
          <Card className="border border-border/60 shadow-sm bg-card/60">
            <CardHeader className="pb-2">
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                <div className="flex flex-col gap-1.5">
                  <CardTitle className="text-md font-bold flex items-center gap-2">
                    <MapIcon className="size-4 text-primary" />
                    Vista GIS
                  </CardTitle>
                  <CardDescription>
                    Analiza los puntos convertidos sobre capturas satelitales (Esri), cartografía OSM,
                    relieve topográfico e imágenes diarias NASA GIBS.
                  </CardDescription>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={mapPoints.length === 0}
                  onClick={() => downloadKml(mapPoints)}
                  className="text-xs shrink-0"
                >
                  <Download className="size-3.5 mr-1" /> Exportar KML
                </Button>
              </div>
            </CardHeader>
            <CardContent className="pt-4">
              <GisMap points={mapPoints} />
            </CardContent>
          </Card>

          {/* Bulk results table */}
          {bulkResults.length > 0 && (
            <Card className="border border-border/60 shadow-sm bg-card/60">
              <CardHeader className="pb-2">
                <CardTitle className="text-md font-bold flex items-center gap-2">
                  <FileSpreadsheet className="size-4 text-primary" />
                  Resultados del lote
                </CardTitle>
                <CardDescription>
                  Revisa cada punto convertido y ábrelo en Google Earth para inspeccionarlo en detalle.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="max-h-72 overflow-auto rounded-lg border border-border/60">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-muted/80 backdrop-blur-sm">
                      <tr className="text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                        <th className="px-3 py-2 font-semibold">#</th>
                        <th className="px-3 py-2 font-semibold">Latitud</th>
                        <th className="px-3 py-2 font-semibold">Longitud</th>
                        <th className="px-3 py-2 font-semibold">Easting (X)</th>
                        <th className="px-3 py-2 font-semibold">Northing (Y)</th>
                        <th className="px-3 py-2 font-semibold">Huso</th>
                        <th className="px-3 py-2 font-semibold text-right">Acciones</th>
                      </tr>
                    </thead>
                    <tbody className="font-mono">
                      {bulkResults.map((pt, index) => (
                        <tr key={index} className="border-t border-border/40">
                          <td className="px-3 py-1.5 text-muted-foreground">P{index + 1}</td>
                          <td className="px-3 py-1.5">{pt.latitude?.toFixed(6) ?? '-'}</td>
                          <td className="px-3 py-1.5">{pt.longitude?.toFixed(6) ?? '-'}</td>
                          <td className="px-3 py-1.5">{pt.easting?.toFixed(2) ?? '-'}</td>
                          <td className="px-3 py-1.5">{pt.northing?.toFixed(2) ?? '-'}</td>
                          <td className="px-3 py-1.5">{pt.zone ?? '-'}</td>
                          <td className="px-3 py-1.5 text-right">
                            {pt.latitude !== undefined && pt.longitude !== undefined ? (
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                onClick={() => {
                                  if (pt.latitude !== undefined && pt.longitude !== undefined) {
                                    openInGoogleEarth(pt.latitude, pt.longitude);
                                  }
                                }}
                                className="size-7"
                                title={`Abrir P${index + 1} en Google Earth`}
                                aria-label={`Abrir P${index + 1} en Google Earth`}
                              >
                                <ExternalLink className="size-3.5" />
                              </Button>
                            ) : (
                              <span className="text-muted-foreground">-</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </PageContainer>
  );
}
