import { extractJson } from '../../common/nvidia';
import type { NvidiaMessage } from '../../common/nvidia';

/** Resultado del OCR de boleta (todos opcionales: el front pre-llena y el usuario corrige). */
export interface ReceiptScanResult {
  concept?: string;
  amount?: number;
  date?: string; // "YYYY-MM-DD"
  category?: string;
}

const PROMPT = `Eres un asistente que lee boletas/recibos chilenos. Analiza la imagen y devuelve
SOLO un objeto JSON crudo (sin markdown) con estos campos cuando puedas inferirlos:
{
  "concept": "descripción corta del gasto",
  "amount": <monto total en CLP como entero, sin puntos ni símbolo>,
  "date": "YYYY-MM-DD",
  "category": "Alimentación | Transporte | Vehículos | Otro(s)"
}
Si un campo no se puede leer, omítelo. No inventes valores.`;

/** Arma el mensaje multimodal (patrón detectShoreline) para la API de NVIDIA. */
export function buildReceiptOcrMessages(imageDataUrl: string): NvidiaMessage[] {
  return [
    {
      role: 'user',
      content: [
        { type: 'text', text: PROMPT },
        { type: 'image_url', image_url: { url: imageDataUrl } },
      ],
    },
  ];
}

/** Parsea la respuesta del modelo a un `ReceiptScanResult` con campos validados por tipo. */
export function parseReceiptOcr(content: string): ReceiptScanResult {
  const raw = extractJson(content) as Record<string, unknown>;
  const result: ReceiptScanResult = {};
  if (typeof raw.concept === 'string' && raw.concept.trim()) result.concept = raw.concept.trim();
  if (typeof raw.amount === 'number' && Number.isFinite(raw.amount)) result.amount = Math.round(raw.amount);
  if (typeof raw.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.date)) result.date = raw.date;
  if (typeof raw.category === 'string' && raw.category.trim()) result.category = raw.category.trim();
  return result;
}
