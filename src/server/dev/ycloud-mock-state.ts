/**
 * 020 — Estado en memoria del ycloud-mock (solo dev/test). Vive en globalThis
 * porque Next recarga módulos en dev; una instancia = un proceso, así que la
 * memoria es suficiente para las aserciones del E2E.
 */
export type MockSent = {
  n: number;
  body: Record<string, unknown>;
  wamid: string;
  at: string;
};

export type MockWebhook = { id: string; url: string; secret: string };

export type YCloudMockState = {
  apiKey: string;
  numbers: { phoneNumber: string; wabaId: string }[];
  webhooks: MockWebhook[];
  sent: MockSent[];
  markedRead: string[];
  uploads: number;
  templates: unknown[];
  /** El próximo registro de webhook responde 500. */
  failWebhook: boolean;
  /** Si es 401/403/5xx, `sendDirectly` responde ese status. */
  sendFail: number | null;
  n: number;
};

const g = globalThis as unknown as { __ycloudMock?: YCloudMockState };

function fresh(): YCloudMockState {
  return {
    apiKey: "yc-e2e-key",
    numbers: [],
    webhooks: [],
    sent: [],
    markedRead: [],
    uploads: 0,
    templates: [],
    failWebhook: false,
    sendFail: null,
    n: 0,
  };
}

export function ycState(): YCloudMockState {
  if (!g.__ycloudMock) g.__ycloudMock = fresh();
  return g.__ycloudMock;
}

export function ycReset(): void {
  g.__ycloudMock = fresh();
}

export function ycNext(): number {
  const s = ycState();
  s.n += 1;
  return s.n;
}
