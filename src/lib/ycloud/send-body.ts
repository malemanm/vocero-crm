/**
 * 020 — El payload interno de envío tiene forma Graph (así lo arman send.ts y
 * templates.ts, y así lo consume Meta). YCloud acepta el mismo contrato de
 * mensajes con tres diferencias, que este módulo puro absorbe:
 *   · no lleva `messaging_product`;
 *   · exige `from` (el número del negocio) y los teléfonos en E.164 con «+»;
 *   · un BSUID viaja en `recipient`, sin `to` ni `recipient_type`.
 */
export function toYCloudSendBody(
  payload: Record<string, unknown>,
  from: string
): Record<string, unknown> {
  const rest: Record<string, unknown> = { ...payload };
  const to = rest.to;
  const recipient = rest.recipient;
  delete rest.messaging_product;
  delete rest.recipient_type;
  delete rest.to;
  delete rest.recipient;

  const body: Record<string, unknown> = { from, ...rest };
  if (typeof to === "string" && to) {
    body.to = to.startsWith("+") ? to : `+${to.replace(/\D/g, "")}`;
  } else if (typeof recipient === "string" && recipient) {
    body.recipient = recipient;
  }
  return body;
}
