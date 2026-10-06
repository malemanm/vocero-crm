/**
 * El mensaje de error de una respuesta de la API interna. La API siempre
 * responde `{ error: { code, message } }` (ver `apiError` en `lib/api.ts`); el
 * compositor de la bandeja leía `message` en la raíz, nunca lo encontraba y
 * enseñaba «Error 422» en lugar de «Todavía no se pueden enviar adjuntos por
 * Messenger; manda el texto».
 */
export async function apiErrorText(res: Response): Promise<string> {
  const data = (await res.json().catch(() => null)) as {
    error?: { message?: string };
    message?: string;
  } | null;
  return data?.error?.message ?? data?.message ?? `Error ${res.status}`;
}
