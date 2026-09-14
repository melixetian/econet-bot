export type LogField = string | number | boolean;

export function logEvent(scope: "bot" | "worker", event: string, fields: Readonly<Record<string, LogField>> = {}): void {
  const details = Object.entries(fields).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join(" ");
  console.error(`[${scope}] event=${event}${details ? ` ${details}` : ""}`);
}

