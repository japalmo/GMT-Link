import type { ChecklistAnswer, ChecklistTemplateView } from '@/types/assets';

/**
 * Construye las respuestas tipadas del checklist a partir del estado del formulario
 * (`executionAnswers`, indexado por id de ítem). Valida y lanza `Error` con mensaje
 * en español ante: (a) un ítem requerido vacío —los SVG son opcionales, un diagrama
 * sin observaciones es válido— y (b) un ESTADO en falla (o con `requireObs`) sin
 * observación.
 *
 * Es la MISMA lógica para las dos entradas al checklist: el formulario del detalle
 * del activo y el overlay de "Reportar uso". Vive aquí para que ambas no se
 * desincronicen (el backend revalida todo de nuevo).
 */
export function buildChecklistAnswers(
  template: ChecklistTemplateView,
  executionAnswers: Record<string, unknown>,
): ChecklistAnswer[] {
  return template.items.map((item) => {
    const raw = executionAnswers[item.id];
    const missing = raw === undefined || raw === null || raw === '';
    // Los SVG son opcionales (un diagrama sin observaciones es válido): no se
    // exige aunque el ítem esté marcado como requerido.
    if (item.required && missing && item.type !== 'SVG') {
      throw new Error(`El ítem "${item.label}" es requerido.`);
    }

    // Valor tipado según el tipo del ítem (null si quedó vacío). SVG guarda el
    // JSON string del mapa de comentarios tal cual (o '{}' si quedó vacío).
    let value: string | number | boolean | null;
    switch (item.type) {
      case 'BOOLEAN':
        value = typeof raw === 'boolean' ? raw : null;
        break;
      case 'ENTERO':
        value = missing ? null : Number(raw);
        break;
      case 'SVG':
        value = missing ? '{}' : String(raw);
        break;
      default: // ESTADO, FECHA, TEXTO
        value = missing ? null : String(raw);
    }

    const answer: ChecklistAnswer = { itemId: item.id, label: item.label, value };

    // La observación companion de un ESTADO (textarea de falla) se guarda como
    // `comment` de su respuesta, además de poblar el ítem TEXTO vinculado por
    // `obsItemId`. El backend exige observación cuando el estado cae en falla O
    // `requireObs` está activo (showObs): se valida aquí para dar la señal inline
    // antes de enviar.
    if (item.type === 'ESTADO') {
      const obsKey = item.config?.obsItemId ?? `${item.id}__obs`;
      const obs = executionAnswers[obsKey];
      const obsText = typeof obs === 'string' ? obs.trim() : '';
      const chosen = typeof value === 'string' ? value : '';
      const isFail = item.config?.failOptions?.includes(chosen) ?? false;
      const showObs = isFail || (item.config?.requireObs ?? false);
      if (showObs && obsText === '') {
        throw new Error(`Debes registrar una observación para "${item.label}".`);
      }
      if (obsText !== '') {
        answer.comment = obsText;
      }
    }

    return answer;
  });
}
