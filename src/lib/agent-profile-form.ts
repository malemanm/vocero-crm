/**
 * Perfil del agente: límites de cada campo y lectura de errores al guardar.
 * Sin dependencias de React ni del servidor, para poder probarlo y para que la
 * pantalla y la API lean los MISMOS números (antes la API tenía los suyos y la
 * pantalla ni los conocía: un campo largo hacía fallar todo el guardado en
 * silencio).
 */
export const PROFILE_LIMITS = {
  name: 60,
  tone: 500,
  instructions: 8000,
  escalationRules: 4000,
  greeting: 1000,
} as const;

export type ProfileField = keyof typeof PROFILE_LIMITS;

const LABELS: Record<ProfileField, string> = {
  name: "Nombre del agente",
  tone: "Tono",
  instructions: "Instrucciones",
  escalationRules: "Reglas de escalado",
  greeting: "Saludo",
};

export function profileFieldLabel(field: ProfileField): string {
  return LABELS[field];
}

export type OverLimit = {
  field: ProfileField;
  label: string;
  length: number;
  max: number;
};

/** Los campos que se pasan de su límite, todos, en el orden de la pantalla. */
export function profileOverLimits(
  form: Partial<Record<ProfileField, string | null>>
): OverLimit[] {
  const out: OverLimit[] = [];
  for (const field of Object.keys(PROFILE_LIMITS) as ProfileField[]) {
    const length = (form[field] ?? "").length;
    const max = PROFILE_LIMITS[field];
    if (length > max) out.push({ field, label: LABELS[field], length, max });
  }
  return out;
}

/**
 * Convierte la respuesta de un guardado en un mensaje para el operador, o
 * null si salió bien. `null` de entrada = la petición ni salió (sin red).
 */
export async function saveErrorMessage(res: Response | null): Promise<string | null> {
  if (!res) return "No se pudo guardar: sin conexión con el servidor. Revisa tu internet e intenta de nuevo.";
  if (res.ok) return null;
  if (res.status === 401) {
    return "No se guardó: tu sesión venció. Recarga la página e inicia sesión de nuevo.";
  }
  const data = (await res.json().catch(() => null)) as {
    error?: { message?: string };
  } | null;
  const detail = data?.error?.message;
  return detail
    ? `No se guardó: ${detail}`
    : `No se guardó (error ${res.status}). Intenta de nuevo.`;
}
