/**
 * Visor 3D de DEM + tabla de cubicación + gráfico temporal (Módulo 5, Albemarle).
 * Auto-contenido: lee /dem/<code>.json (grid de elevaciones) y /dem/<code>-cubicacion.json
 * (variables × fechas) desde public/. Pensado para la demo: no depende de la API/DB.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

interface DemGrid {
  code: string;
  width: number;
  height: number;
  bbox: [number, number, number, number];
  minZ: number;
  maxZ: number;
  noData: number | null;
  elevations: number[];
}

interface VarDef {
  key: string;
  label: string;
  unit: string;
}
interface CubRow {
  fecha: string;
  [key: string]: string | number;
}
interface Cubicacion {
  elementCode: string;
  elementName: string;
  variables: VarDef[];
  series: CubRow[];
}

const VERTICAL_EXAGGERATION = 6; // ~4.3 m de relieve sobre ~117 m → realza el relieve

/** Lienzo three.js: heightmap del DEM con OrbitControls y colormap por elevación. */
function Terrain3D({ grid }: { grid: DemGrid }): ReactNode {
  const mountRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const width = mount.clientWidth || 600;
    const height = 440;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0b1220);

    const camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 100000);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    mount.appendChild(renderer.domElement);

    const [minX, minY, maxX, maxY] = grid.bbox;
    const realW = Math.abs(maxX - minX) || grid.width;
    const realH = Math.abs(maxY - minY) || grid.height;

    const geom = new THREE.PlaneGeometry(realW, realH, grid.width - 1, grid.height - 1);
    const pos = geom.attributes.position as THREE.BufferAttribute;
    const elev = grid.elevations;
    const range = grid.maxZ - grid.minZ || 1;

    const colors = new Float32Array(pos.count * 3);
    const lo = new THREE.Color(0x1e3a8a); // azul (fondo de poza)
    const mid = new THREE.Color(0x10b981); // verde
    const hi = new THREE.Color(0xfbbf24); // ámbar (bordes altos)
    const tmp = new THREE.Color();

    for (let i = 0; i < pos.count; i++) {
      const e = elev[i] ?? grid.minZ;
      pos.setZ(i, (e - grid.minZ) * VERTICAL_EXAGGERATION);
      const t = (e - grid.minZ) / range;
      if (t < 0.5) tmp.lerpColors(lo, mid, t * 2);
      else tmp.lerpColors(mid, hi, (t - 0.5) * 2);
      colors[i * 3] = tmp.r;
      colors[i * 3 + 1] = tmp.g;
      colors[i * 3 + 2] = tmp.b;
    }
    geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geom.computeVertexNormals();

    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      side: THREE.DoubleSide,
      roughness: 0.95,
      metalness: 0.0,
    });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.rotation.x = -Math.PI / 2; // plano XY → suelo XZ, elevación = Y
    scene.add(mesh);

    const dir = new THREE.DirectionalLight(0xffffff, 1.5);
    dir.position.set(realW, realH * 2, realH);
    scene.add(dir);
    scene.add(new THREE.AmbientLight(0xffffff, 0.55));

    const maxDim = Math.max(realW, realH);
    camera.position.set(realW * 0.6, maxDim * 0.8, realH * 0.9);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.target.set(0, 0, 0);
    controls.update();

    let raf = 0;
    const animate = (): void => {
      controls.update();
      renderer.render(scene, camera);
      raf = requestAnimationFrame(animate);
    };
    animate();

    const onResize = (): void => {
      const w = mount.clientWidth || 600;
      camera.aspect = w / height;
      camera.updateProjectionMatrix();
      renderer.setSize(w, height);
    };
    window.addEventListener('resize', onResize);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      controls.dispose();
      geom.dispose();
      mat.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement);
    };
  }, [grid]);

  return <div ref={mountRef} className="h-[440px] w-full overflow-hidden rounded-lg border border-border" />;
}

/** Gráfico de líneas SVG simple (sin dependencias) para una variable a lo largo del tiempo. */
function TimeChart({ data, varDef }: { data: CubRow[]; varDef: VarDef }): ReactNode {
  const W = 560;
  const H = 220;
  const pad = { l: 56, r: 16, t: 16, b: 28 };
  const values = data.map((r) => Number(r[varDef.key]));
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const x = (i: number): number => pad.l + (i * (W - pad.l - pad.r)) / Math.max(1, data.length - 1);
  const y = (v: number): number => pad.t + (1 - (v - min) / span) * (H - pad.t - pad.b);
  const path = values.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`Serie temporal de ${varDef.label}`}>
      <line x1={pad.l} y1={pad.t} x2={pad.l} y2={H - pad.b} stroke="var(--border)" strokeOpacity={0.4} />
      <line x1={pad.l} y1={H - pad.b} x2={W - pad.r} y2={H - pad.b} stroke="var(--border)" strokeOpacity={0.4} />
      <text x={pad.l - 6} y={y(max)} textAnchor="end" dominantBaseline="middle" fontSize="10" fill="var(--muted-foreground)">{max.toLocaleString('es-CL')}</text>
      <text x={pad.l - 6} y={y(min)} textAnchor="end" dominantBaseline="middle" fontSize="10" fill="var(--muted-foreground)">{min.toLocaleString('es-CL')}</text>
      <path d={path} fill="none" stroke="var(--primary)" strokeWidth={2} />
      {values.map((v, i) => (
        <g key={i}>
          <circle cx={x(i)} cy={y(v)} r={3} fill="var(--primary)" />
          <text x={x(i)} y={H - pad.b + 14} textAnchor="middle" fontSize="9" fill="var(--muted-foreground)">
            {(data[i]?.fecha ?? '').slice(5)}
          </text>
        </g>
      ))}
    </svg>
  );
}

/** Visor completo para un Element (poza/reservorio): 3D + tabla + gráfico. */
export function DemViewer({ code = 'R2' }: { code?: string }): ReactNode {
  const [grid, setGrid] = useState<DemGrid | null>(null);
  const [cub, setCub] = useState<Cubicacion | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [chartVar, setChartVar] = useState<string>('vol_total_salmuera');

  useEffect(() => {
    let alive = true;
    Promise.all([
      fetch(`/dem/${code}.json`).then((r) => (r.ok ? r.json() : Promise.reject(new Error('DEM no encontrado')))),
      fetch(`/dem/${code}-cubicacion.json`).then((r) => (r.ok ? r.json() : Promise.reject(new Error('Cubicación no encontrada')))),
    ])
      .then(([g, c]: [DemGrid, Cubicacion]) => {
        if (!alive) return;
        setGrid(g);
        setCub(c);
      })
      .catch((e: unknown) => alive && setError(e instanceof Error ? e.message : 'Error al cargar el visor'));
    return () => {
      alive = false;
    };
  }, [code]);

  const selectedVar = useMemo(() => cub?.variables.find((v) => v.key === chartVar) ?? cub?.variables[0], [cub, chartVar]);

  if (error) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">No se pudo cargar el visor: {error}</CardContent>
      </Card>
    );
  }
  if (!grid || !cub || !selectedVar) {
    return (
      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardContent className="flex h-[480px] items-center justify-center">
            <div className="flex flex-col items-center gap-3 text-muted-foreground">
              <svg className="size-8 animate-spin text-primary" viewBox="0 0 24 24" fill="none" aria-hidden>
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.4 0 0 5.4 0 12h4z" />
              </svg>
              <span className="text-sm">Cargando terreno 3D y datos de cubicación…</span>
            </div>
          </CardContent>
        </Card>
        <div className="lg:col-span-2">
          <Card>
            <CardContent className="h-[480px] animate-pulse rounded-lg bg-muted/30" />
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-5">
      <Card className="lg:col-span-3">
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">Visor 3D — {cub.elementName}</CardTitle>
          <Badge variant="secondary">
            Δ {(grid.maxZ - grid.minZ).toFixed(1)} m · {grid.width}×{grid.height}
          </Badge>
        </CardHeader>
        <CardContent>
          <Terrain3D grid={grid} />
          <p className="mt-2 text-xs text-muted-foreground">
            Arrastrá para orbitar · rueda para zoom. Exageración vertical ×{VERTICAL_EXAGGERATION}. Cota {grid.minZ.toFixed(1)}–{grid.maxZ.toFixed(1)} m s.n.m.
          </p>
        </CardContent>
      </Card>

      <div className="space-y-4 lg:col-span-2">
        <Card>
          <CardHeader className="space-y-0 pb-2">
            <CardTitle className="text-base">Evolución temporal</CardTitle>
          </CardHeader>
          <CardContent>
            <select
              value={chartVar}
              onChange={(e) => setChartVar(e.target.value)}
              className="mb-2 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
            >
              {cub.variables.map((v) => (
                <option key={v.key} value={v.key}>
                  {v.label} ({v.unit})
                </option>
              ))}
            </select>
            <TimeChart data={cub.series} varDef={selectedVar} />
          </CardContent>
        </Card>
      </div>

      <Card className="lg:col-span-5">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Datos de cubicación — {cub.elementName}</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="py-2 pr-3 font-medium">Fecha</th>
                {cub.variables.map((v) => (
                  <th key={v.key} className="px-3 py-2 text-right font-medium">
                    {v.label}
                    <span className="block text-[10px] font-normal">{v.unit}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {cub.series.map((row) => (
                <tr key={row.fecha} className="border-b border-border/50">
                  <td className="py-2 pr-3 font-medium">{row.fecha}</td>
                  {cub.variables.map((v) => (
                    <td key={v.key} className="px-3 py-2 text-right tabular-nums">
                      {Number(row[v.key]).toLocaleString('es-CL')}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
