import { useEffect, useRef, useState, type ReactNode } from 'react';
import { QRCodeCanvas } from 'qrcode.react';
import { Check, Copy, Download, ExternalLink, Mail, MessageCircle, Share2 } from 'lucide-react';

/**
 * Ficha técnica de un activo: el QR que va grabado en la plaquita, más las tres
 * acciones que se hacen con él.
 *
 * Vive arriba a la derecha del nombre del activo, no dentro de una pestaña: es
 * lo que alguien busca apenas entra al detalle, y esconderlo tras un clic
 * obligaba a acordarse de en qué pestaña estaba.
 *
 * El QR que se descarga es de 1024 px porque el grabado láser vectoriza desde la
 * imagen y uno de pantalla sale pixelado en metal. El nivel de corrección de
 * error es "H" (el más alto): una plaquita atornillada a un vehículo se raya y
 * se llena de polvo, y con ese nivel el código sigue leyéndose con hasta un 30%
 * de la superficie dañada.
 */
export function QrFichaPublica({
  publicToken,
  code,
  nombre,
}: {
  publicToken: string;
  code: string;
  nombre?: string;
}): ReactNode {
  const [copiado, setCopiado] = useState(false);
  const [menu, setMenu] = useState<'compartir' | 'descargar' | null>(null);
  const contenedor = useRef<HTMLDivElement>(null);
  // Dos refs: el QR visible es chico y el que se descarga es el de 1024 px. Con
  // un solo ref React asignaría el último renderizado y la descarga dependería
  // del orden del JSX, que es el tipo de fragilidad que no se nota hasta que
  // alguien reordena el archivo.
  const contenedorAlta = useRef<HTMLDivElement>(null);

  // Se arma con el origen actual: así el QR apunta al mismo dominio desde el que
  // se está mirando, y no a uno escrito a mano que después cambie.
  const url = `${window.location.origin}/public/activos/${publicToken}`;
  const titulo = nombre ? `${nombre} (${code})` : code;

  // Cierra el menú al hacer clic fuera. Sin esto quedan menús abiertos por toda
  // la pantalla al ir de una acción a otra.
  useEffect(() => {
    if (!menu) return undefined;
    const fuera = (e: MouseEvent): void => {
      if (!contenedor.current?.contains(e.target as Node)) setMenu(null);
    };
    document.addEventListener('mousedown', fuera);
    return () => document.removeEventListener('mousedown', fuera);
  }, [menu]);

  async function copiar(): Promise<void> {
    try {
      await navigator.clipboard.writeText(url);
      setCopiado(true);
      window.setTimeout(() => setCopiado(false), 2000);
    } catch {
      setCopiado(false);
    }
    setMenu(null);
  }

  function descargarImagen(): void {
    const canvas = contenedorAlta.current?.querySelector('canvas');
    if (!canvas) return;
    const enlace = document.createElement('a');
    enlace.download = `QR-${code}.png`;
    enlace.href = canvas.toDataURL('image/png');
    enlace.click();
    setMenu(null);
  }

  /**
   * Hoja imprimible con el QR: el navegador ofrece "Guardar como PDF" en su
   * propio diálogo. Se prefiere esto a armar el PDF a mano porque un PDF
   * generado con los offsets mal calculados no abre en ningún lado, y acá el
   * archivo lo produce el navegador, que sí sabe hacerlo.
   */
  function descargarPdf(): void {
    const canvas = contenedorAlta.current?.querySelector('canvas');
    if (!canvas) return;
    const png = canvas.toDataURL('image/png');
    const ventana = window.open('', '_blank', 'noopener,noreferrer,width=720,height=900');
    if (!ventana) return;
    ventana.document.write(
      `<!doctype html><html lang="es"><head><meta charset="utf-8">` +
        `<title>Ficha tecnica ${code}</title><style>` +
        `body{margin:0;display:flex;min-height:100vh;align-items:center;justify-content:center;` +
        `font-family:system-ui,sans-serif;color:#0f172a}` +
        `.hoja{text-align:center}img{width:11cm;height:11cm}` +
        `h1{font-size:20pt;margin:0 0 .2cm}p{font-size:11pt;margin:.15cm 0;color:#475569}` +
        `@media print{@page{margin:1.5cm}}` +
        `</style></head><body><div class="hoja">` +
        `<h1>${titulo.replace(/</g, '&lt;')}</h1>` +
        `<img src="${png}" alt="Codigo QR de la ficha tecnica">` +
        `<p>Escanea para ver la ficha tecnica</p></div>` +
        // La etiqueta de cierre va partida: escrita entera, un empaquetador que
        // dejara este archivo dentro de un <script> la leería como el cierre de
        // ESE script y cortaría el bundle a la mitad.
        `<script>window.onload=function(){window.print()}<` + `/script></body></html>`,
    );
    ventana.document.close();
    setMenu(null);
  }

  function compartirWhatsapp(): void {
    const texto = `Ficha técnica de ${titulo}: ${url}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(texto)}`, '_blank', 'noopener,noreferrer');
    setMenu(null);
  }

  function compartirCorreo(): void {
    const asunto = encodeURIComponent(`Ficha técnica de ${titulo}`);
    const cuerpo = encodeURIComponent(`Puedes ver la ficha técnica en este enlace:\n\n${url}`);
    window.location.href = `mailto:?subject=${asunto}&body=${cuerpo}`;
    setMenu(null);
  }

  return (
    <div ref={contenedor} className="relative shrink-0">
      <div className="flex flex-col items-center gap-2 rounded-lg border bg-card p-2.5">
        <div className="rounded bg-white p-1.5">
          <QRCodeCanvas value={url} size={104} level="H" marginSize={1} />
        </div>

        <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          Ficha técnica
        </p>

        <div className="flex items-center gap-1">
          <BotonIcono
            titulo="Compartir"
            activo={menu === 'compartir'}
            onClick={() => setMenu((m) => (m === 'compartir' ? null : 'compartir'))}
          >
            {copiado ? <Check className="size-4" /> : <Share2 className="size-4" />}
          </BotonIcono>

          <BotonIcono
            titulo="Descargar QR"
            activo={menu === 'descargar'}
            onClick={() => setMenu((m) => (m === 'descargar' ? null : 'descargar'))}
          >
            <Download className="size-4" />
          </BotonIcono>

          <BotonIcono
            titulo="Ir a la ficha técnica"
            activo={false}
            onClick={() => window.open(url, '_blank', 'noopener,noreferrer')}
          >
            <ExternalLink className="size-4" />
          </BotonIcono>
        </div>
      </div>

      {menu ? (
        <div className="absolute right-0 top-full z-20 mt-1 w-52 overflow-hidden rounded-md border bg-popover shadow-md">
          {menu === 'compartir' ? (
            <>
              <OpcionMenu icono={<MessageCircle className="size-4" />} onClick={compartirWhatsapp}>
                Compartir por WhatsApp
              </OpcionMenu>
              <OpcionMenu icono={<Mail className="size-4" />} onClick={compartirCorreo}>
                Compartir por correo
              </OpcionMenu>
              <OpcionMenu icono={<Copy className="size-4" />} onClick={() => void copiar()}>
                Copiar enlace
              </OpcionMenu>
            </>
          ) : (
            <>
              <OpcionMenu icono={<Download className="size-4" />} onClick={descargarImagen}>
                Descargar como imagen
              </OpcionMenu>
              <OpcionMenu icono={<Download className="size-4" />} onClick={descargarPdf}>
                Guardar como PDF
              </OpcionMenu>
            </>
          )}
        </div>
      ) : null}

      {/* Copia oculta a 1024 px: es la que se descarga para el grabado. */}
      <div className="hidden" aria-hidden>
        <div ref={contenedorAlta}>
          <QRCodeCanvas value={url} size={1024} level="H" marginSize={2} />
        </div>
      </div>
    </div>
  );
}

function BotonIcono({
  titulo,
  activo,
  onClick,
  children,
}: {
  titulo: string;
  activo: boolean;
  onClick: () => void;
  children: ReactNode;
}): ReactNode {
  return (
    <button
      type="button"
      title={titulo}
      aria-label={titulo}
      aria-expanded={activo}
      onClick={onClick}
      className={`inline-flex size-8 items-center justify-center rounded-md border transition-colors ${
        activo
          ? 'border-primary bg-primary/10 text-primary'
          : 'text-muted-foreground hover:bg-accent hover:text-foreground'
      }`}
    >
      {children}
    </button>
  );
}

function OpcionMenu({
  icono,
  onClick,
  children,
}: {
  icono: ReactNode;
  onClick: () => void;
  children: ReactNode;
}): ReactNode {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-foreground hover:bg-accent"
    >
      {icono}
      {children}
    </button>
  );
}

export default QrFichaPublica;
