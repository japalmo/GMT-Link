/** Lado mayor, en píxeles, de una foto lista para subir. */
const MAX_LADO = 1600;

/**
 * Pasa la foto a JPEG y la achica al lado mayor permitido. Achicar acá evita
 * subidas de 8 MB desde un celular con una barra de señal, y convertir a JPEG
 * resuelve el HEIC del iPhone, que el PDF no sabe incrustar.
 */
export async function prepararFoto(archivo: File, maxLado = MAX_LADO): Promise<File> {
  const url = URL.createObjectURL(archivo);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('formato no soportado'));
      el.src = url;
    });
    const escala = Math.min(1, maxLado / Math.max(img.width, img.height));
    const lienzo = document.createElement('canvas');
    lienzo.width = Math.round(img.width * escala);
    lienzo.height = Math.round(img.height * escala);
    const ctx = lienzo.getContext('2d');
    if (!ctx) throw new Error('sin canvas');
    ctx.drawImage(img, 0, 0, lienzo.width, lienzo.height);
    const blob = await new Promise<Blob | null>((resolve) =>
      lienzo.toBlob(resolve, 'image/jpeg', 0.82),
    );
    if (!blob) throw new Error('no se pudo convertir');
    return new File([blob], archivo.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' });
  } finally {
    URL.revokeObjectURL(url);
  }
}
