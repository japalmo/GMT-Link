import { useEffect, useState, type ReactNode } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getPublicAsset } from '@/lib/api';
import {
  Wrench,
  Car,
  Construction,
  Briefcase,
  Factory,
  FileText,
  ClipboardCheck,
  ShieldAlert,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { BrandLogo } from '@/components/branding/brand-logo';
import type { AssetPublicView, AssetStatus } from '@/types/assets';
import { ASSET_TYPE_LABELS } from '@/types/assets';

export default function PublicAssetPage(): ReactNode {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const [asset, setAsset] = useState<AssetPublicView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    setError(null);
    getPublicAsset(token)
      .then((res) => {
        setAsset(res);
      })
      .catch((err) => {
        setError(err.message || 'No se pudo cargar la ficha del activo.');
      })
      .finally(() => {
        setLoading(false);
      });
  }, [token]);

  const statusBadge = (status: AssetStatus) => {
    switch (status) {
      case 'DISPONIBLE':
        return <Badge className="bg-emerald-500/10 text-emerald-500 border-emerald-500/20 text-sm py-1">Disponible</Badge>;
      case 'EN_USO':
        return <Badge className="bg-blue-500/10 text-blue-400 border-blue-500/20 text-sm py-1">En Uso</Badge>;
      case 'MANTENIMIENTO':
        return <Badge className="bg-amber-500/10 text-amber-500 border-amber-500/20 text-sm py-1">Mantenimiento</Badge>;
      case 'BAJA':
        return <Badge className="bg-rose-500/10 text-rose-500 border-rose-500/20 text-sm py-1">De Baja</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4">
      {/* Container */}
      <div className="w-full max-w-md">
        {/* Brand Header: logotipo real (consciente del tema; anónimos ven claro). */}
        <div className="mb-6 flex justify-center">
          <BrandLogo variant="logo" className="h-20" />
        </div>

        {loading ? (
          <Card className="animate-pulse bg-card/40 border border-border">
            <CardHeader className="h-32 bg-muted/20" />
            <CardContent className="h-48 space-y-4 p-6">
              <div className="h-4 bg-muted rounded w-2/3" />
              <div className="h-4 bg-muted rounded w-1/2" />
              <div className="h-4 bg-muted rounded w-3/4" />
            </CardContent>
          </Card>
        ) : error || !asset ? (
          <Card className="bg-card/40 border border-destructive/20 text-center p-6 flex flex-col items-center gap-4">
            <ShieldAlert className="size-16 text-destructive" />
            <div>
              <CardTitle className="text-destructive font-semibold">Error al consultar activo</CardTitle>
              <CardDescription className="mt-2 text-sm text-muted-foreground">
                {error || 'El enlace del activo es inválido o no existe en la plataforma.'}
              </CardDescription>
            </div>
          </Card>
        ) : (
          <Card className="bg-card border border-border shadow-lg overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-300">
            {/* Visual indicator top header */}
            <div className="h-2 bg-gradient-to-r from-primary to-primary/40" />

            <CardHeader className="text-center pb-4">
              <div className="mx-auto size-16 rounded-full bg-primary/5 border border-primary/10 flex items-center justify-center mb-3">
                {asset.type === 'VEHICULO' ? (
                  <Car className="size-8 text-primary" />
                ) : asset.type === 'MAQUINARIA' ? (
                  <Construction className="size-8 text-primary" />
                ) : (
                  <Wrench className="size-8 text-primary" />
                )}
              </div>
              <CardTitle className="text-xl font-bold text-foreground">{asset.name}</CardTitle>
              <CardDescription className="font-mono text-sm mt-1">
                Ficha Técnica: <span className="font-bold text-primary">{asset.code}</span>
              </CardDescription>
            </CardHeader>

            <CardContent className="space-y-4 px-6 text-sm">
              <div className="flex justify-between items-center border-b border-border/60 pb-3">
                <span className="text-muted-foreground">Tipo de Activo:</span>
                <span className="font-semibold text-foreground">
                  {ASSET_TYPE_LABELS[asset.type]}
                </span>
              </div>

              <div className="flex justify-between items-center border-b border-border/60 pb-3">
                <span className="text-muted-foreground">Estado Operativo:</span>
                {statusBadge(asset.status)}
              </div>

              {asset.manufacturer && (
                <div className="flex justify-between items-center border-b border-border/60 pb-3">
                  <span className="text-muted-foreground flex items-center gap-1.5">
                    <Factory className="size-4" /> Fabricante:
                  </span>
                  <span className="font-semibold text-foreground">{asset.manufacturer}</span>
                </div>
              )}

              <div className="flex justify-between items-center border-b border-border/60 pb-3">
                <span className="text-muted-foreground flex items-center gap-1.5">
                  <Briefcase className="size-4" /> Proyecto Asignado:
                </span>
                <span className="font-semibold text-foreground">
                  {asset.project?.name || 'Global / Sin asignar'}
                </span>
              </div>

              {/* Documentos aprobados (Tanda 5.2): prueba de documentación al día. */}
              {asset.documents.length > 0 && (
                <div className="border-b border-border/60 pb-3">
                  <p className="mb-2 flex items-center gap-1.5 text-muted-foreground">
                    <FileText className="size-4" /> Documentos:
                  </p>
                  <ul className="flex flex-col gap-1.5">
                    {asset.documents.map((doc, i) => (
                      <li key={`${doc.name}-${i}`} className="flex items-center justify-between gap-2">
                        <span className="font-medium text-foreground">{doc.name}</span>
                        {doc.expired ? (
                          <Badge className="bg-rose-500/10 text-rose-500 border-rose-500/20">Vencido</Badge>
                        ) : doc.expiringSoon ? (
                          <Badge className="bg-amber-500/10 text-amber-500 border-amber-500/20">Por vencer</Badge>
                        ) : (
                          <Badge className="bg-emerald-500/10 text-emerald-500 border-emerald-500/20">Vigente</Badge>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Última inspección de checklist (Tanda 5.2). */}
              {asset.lastChecklist && (
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground flex items-center gap-1.5">
                    <ClipboardCheck className="size-4" /> Última inspección:
                  </span>
                  <span className="font-semibold text-foreground">
                    {asset.lastChecklist.templateName} ·{' '}
                    {new Date(asset.lastChecklist.submittedAt).toLocaleDateString('es-CL')}
                  </span>
                </div>
              )}
            </CardContent>

            {/* Acciones con deep-link post-login (Tanda 6): llevan a la app autenticada.
                Los guards resuelven la sesión: si no hay, ProtectedRoute manda a login
                preservando el destino y PublicRoute vuelve aquí tras loguear. El id solo
                se usa dentro de la app (que exige login + permiso). Si por algún motivo
                no viene (ficha muy vieja), se ocultan. */}
            {asset.id && (
              <div className="flex flex-col gap-3 px-6 pb-6">
                <Button
                  className="w-full"
                  onClick={() => navigate(`/recursos?asset=${encodeURIComponent(asset.id)}&accion=ver-docs`)}
                >
                  <FileText className="size-4" />
                  Ver documentos
                </Button>
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => navigate(`/recursos?asset=${encodeURIComponent(asset.id)}&accion=reportar-uso`)}
                >
                  <ClipboardCheck className="size-4" />
                  Registrar uso
                </Button>
              </div>
            )}

            <CardFooter className="bg-muted/30 border-t py-4 text-center justify-center">
              <p className="text-[10px] text-muted-foreground">
                GMT Link © 2026. Plataforma de Gestión Interna de GMT.
              </p>
            </CardFooter>
          </Card>
        )}
      </div>
    </div>
  );
}
