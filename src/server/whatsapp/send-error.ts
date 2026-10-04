/** Error tipado del envío; `code` mapea a HTTP en la capa de API. */
export class SendError extends Error {
  code:
    | "sandbox_violation"
    | "not_connected"
    | "reconnect_required"
    | "window_closed"
    | "meta_error"
    | "meta_unavailable"
    | "upload_failed";
  /** 008: presente cuando el fallo ocurrió TRAS persistir el mensaje (failed). */
  messageId?: string;

  constructor(code: SendError["code"], message: string) {
    super(message);
    this.name = "SendError";
    this.code = code;
  }
}
