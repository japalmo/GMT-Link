import { GoogleGenerativeAI } from '@google/generative-ai';

// Initialize with env variable
const genAI = new GoogleGenerativeAI(import.meta.env.VITE_GEMINI_API_KEY);

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function normalizeMimeType(file) {
  if (file?.type) return file.type;
  if (file?.name?.toLowerCase().endsWith('.pdf')) return 'application/pdf';
  return 'image/jpeg';
}

function isMissingField(value) {
  if (value == null) return true;
  if (typeof value === 'string') return value.trim() === '';
  return false;
}

export function hasLowConfidenceReceiptData(data) {
  const missingCoreFields = [
    isMissingField(data?.amount),
    isMissingField(data?.expenseDate),
    isMissingField(data?.merchantName),
  ].filter(Boolean).length;

  return missingCoreFields >= 2;
}

export async function extractReceiptData(file) {
  const base64 = await fileToBase64(file);
  const mimeType = normalizeMimeType(file);
  const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

  const result = await model.generateContent([
    {
      inlineData: {
        mimeType,
        data: base64,
      },
    },
    `Analiza esta boleta o factura chilena y extrae los datos. Responde SOLO con un objeto JSON válido con exactamente estos campos:
{"category":"Bencina|Peajes|Alimentación|Alojamiento|Otros","concept":"descripción breve del gasto","amount":número_entero_en_CLP_sin_puntos,"expenseDate":"YYYY-MM-DD","merchantName":"nombre del comercio","receiptNumber":"número de boleta o factura o vacío"}
Si no puedes leer un campo, usa null. Solo JSON, sin texto adicional.`
  ]);

  const text = result.response.text().trim().replace(/```json|```/g, '').trim();
  return JSON.parse(text);
}

