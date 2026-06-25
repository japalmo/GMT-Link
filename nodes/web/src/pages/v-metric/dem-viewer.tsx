/**
 * Visor 3D de DEM + tabla de cubicación + gráfico temporal (Módulo 5, Albemarle).
 * Auto-contenido: lee /dem/<code>.json (grid de elevaciones) y /dem/<code>-cubicacion.json
 * (variables × fechas) desde public/. Pensado para la demo: no depende de la API/DB.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
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

/** Lienzo three.js: heightmap del DEM con OrbitControls y colormap por elevación. */
function Terrain3D({ grid, exaggeration }: { grid: DemGrid; exaggeration: number }): ReactNode {
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
      pos.setZ(i, (e - grid.minZ) * exaggeration);
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
  }, [grid, exaggeration]);

  return <div ref={mountRef} className="h-[440px] w-full overflow-hidden rounded-lg border border-border" />;
}

export function DemViewer({ code = 'R2' }: { code?: string }): ReactNode {
  const [grid, setGrid] = useState<DemGrid | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exaggeration, setExaggeration] = useState(1.0); // original scale by default

  useEffect(() => {
    let alive = true;
    fetch(`/dem/${code}.json`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('DEM no encontrado'))))
      .then((g: DemGrid) => {
        if (!alive) return;
        setGrid(g);
      })
      .catch((e: unknown) => alive && setError(e instanceof Error ? e.message : 'Error al cargar el visor 3D'));
    return () => {
      alive = false;
    };
  }, [code]);

  if (error) {
    return (
      <Card className="border border-border/60 bg-card/50">
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          No se pudo cargar el visor 3D: {error}
        </CardContent>
      </Card>
    );
  }

  if (!grid) {
    return (
      <Card className="border border-border/60 bg-card/50">
        <CardContent className="flex h-[440px] items-center justify-center">
          <div className="flex flex-col items-center gap-3 text-muted-foreground">
            <svg className="size-8 animate-spin text-primary" viewBox="0 0 24 24" fill="none" aria-hidden>
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.4 0 0 5.4 0 12h4z" />
            </svg>
            <span className="text-sm">Cargando terreno 3D…</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border border-border/60 bg-card/50 shadow-md">
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">Visor de Elevación 3D (DEM)</CardTitle>
        <Badge variant="secondary">
          Δ {(grid.maxZ - grid.minZ).toFixed(1)} m · {grid.width}×{grid.height}
        </Badge>
      </CardHeader>
      <CardContent>
        <Terrain3D grid={grid} exaggeration={exaggeration} />
        
        <div className="mt-4 flex flex-col gap-2 p-3 rounded-xl bg-accent/10 border border-border/40">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground font-semibold flex items-center gap-1">
              ⛰️ Exageración vertical del relieve:
            </span>
            <div className="flex items-center gap-3">
              <input
                type="range"
                min="1"
                max="15"
                step="0.5"
                value={exaggeration}
                onChange={(e) => setExaggeration(parseFloat(e.target.value))}
                className="h-1.5 w-36 cursor-pointer appearance-none rounded-lg bg-orange-200 accent-orange-600 dark:bg-orange-950/40"
              />
              <span className="text-xs font-mono font-black text-orange-600 dark:text-orange-500 bg-orange-500/10 border border-orange-500/25 px-2 py-0.5 rounded-lg select-none">
                {exaggeration.toFixed(1)}x
              </span>
            </div>
          </div>
          <p className="text-[10px] text-muted-foreground leading-relaxed">
            Arrastra con clic izquierdo para orbitar · clic derecho para desplazar · rueda para zoom. Escala real por defecto (1.0x). Rango de cotas: {grid.minZ.toFixed(1)}–{grid.maxZ.toFixed(1)} m s.n.m.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
