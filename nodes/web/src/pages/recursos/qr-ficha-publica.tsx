import { useRef, useState, type ReactNode } from 'react';
import { QRCodeCanvas } from 'qrcode.react';
import { Copy, Check, Download, ExternalLink, QrCode } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

/**
 * Tarjeta con el QR y el enlace de la ficha pública de un activo.
 *
 * Existe para fabricar las plaquitas grabadas de la flota: el QR se descarga en
 * alta resolución (1024 px) porque el grabado láser vectoriza desde la imagen y
 * un QR de pantalla sale pixelado en metal.
 *
 * El nivel de corrección de error es "H" (el más alto) a propósito: una plaquita
 * atornillada a un vehículo se raya, se ensucia y se llena de polvo, y con ese
 * nivel el código sigue leyéndose con hasta un 30% de la superficie dañada.
 */
export function QrFichaPublica({
  publicToken,
  code,
}: {
  publicToken: string;
  code: string;
}): ReactNode {
  const [copiado, setCopiado] = useState(false);
  // Dos refs: el QR visible es chico y el que se descarga es el de 1024 px.
  // Con un solo ref, React asignaría el último renderizado y la descarga
  // dependería del orden del JSX, que es exactamente el tipo de fragilidad
  // que no se nota hasta que alguien reordena el archivo.
  const contenedorAlta = useRef<HTMLDivElement>(null);

  // Se arma con el origen actual: así el QR apunta al mismo dominio desde el que
  // se está mirando, y no a uno escrito a mano que después cambie.
  const url = `${window.location.origin}/public/activos/${publicToken}`;

  async function copiar(): Promise<void> {
    try {
      await navigator.clipboard.writeText(url);
      setCopiado(true);
      window.setTimeout(() => setCopiado(false), 2000);
    } catch {
      setCopiado(false);
    }
  }

  function descargar(): void {
    const canvas = contenedorAlta.current?.querySelector('canvas');
    if (!canvas) return;
    const enlace = document.createElement('a');
    enlace.download = `QR-${code}.png`;
    enlace.href = canvas.toDataURL('image/png');
    enlace.click();
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <QrCode className="size-4" /> Ficha pública
        </CardTitle>
        <CardDescription>
          Este es el código que va en la plaquita del vehículo. Quien lo escanee
          ve los datos del activo y sus documentos, sin necesidad de iniciar sesión.
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-start">
        {/* El QR visible es chico; el que se descarga se genera a 1024 px. */}
        <div className="mx-auto shrink-0 rounded-lg bg-white p-3 sm:mx-0">
          <QRCodeCanvas value={url} size={132} level="H" marginSize={2} />
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <div className="min-w-0">
            <p className="mb-1 text-xs text-muted-foreground">Enlace de la ficha</p>
            <p className="break-all rounded-md bg-muted/50 px-2 py-1.5 font-mono text-xs">
              {url}
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={copiar}>
              {copiado ? <Check className="size-4" /> : <Copy className="size-4" />}
              {copiado ? 'Copiado' : 'Copiar enlace'}
            </Button>
            <Button variant="outline" size="sm" onClick={descargar}>
              <Download className="size-4" /> Descargar QR
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => window.open(url, '_blank', 'noopener,noreferrer')}
            >
              <ExternalLink className="size-4" /> Ver ficha
            </Button>
          </div>

          {/* Copia oculta a 1024 px: es la que se descarga para el grabado. */}
          <div className="hidden" aria-hidden>
            <div ref={contenedorAlta}>
              <QRCodeCanvas value={url} size={1024} level="H" marginSize={2} />
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default QrFichaPublica;
