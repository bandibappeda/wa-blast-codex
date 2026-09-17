import { resolve } from "node:path";

export interface AppConfig {
  appEnv: string;
  appOrigin: string;
  apiHost: string;
  apiPort: number;
  databasePath: string;
  uploadsPath: string;
  defaultPhoneCountry: string;
  organizationTimeZone: string;
  sessionTtlHours: number;
  sessionCookieSecure: boolean;
  gatewayEncryptionKey?: string;
}

type Environment = Record<string, string | undefined>;

const numberFrom = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export function loadConfig(environment: Environment = Bun.env): AppConfig {
  return {
    appEnv: environment.APP_ENV ?? "development",
    appOrigin: environment.APP_ORIGIN ?? "http://localhost:5173",
    apiHost: environment.API_HOST ?? "127.0.0.1",
    apiPort: numberFrom(environment.API_PORT, 3000),
    databasePath: resolve(environment.DATABASE_PATH ?? "./var/data/wa-blast.db"),
    uploadsPath: resolve(environment.UPLOADS_PATH ?? "./var/uploads"),
    defaultPhoneCountry: environment.DEFAULT_PHONE_COUNTRY ?? "ID",
    organizationTimeZone: environment.ORGANIZATION_TIME_ZONE ?? "Asia/Jakarta",
    sessionTtlHours: numberFrom(environment.SESSION_TTL_HOURS, 12),
    sessionCookieSecure: environment.SESSION_COOKIE_SECURE === "true",
    ...(environment.GATEWAY_ENCRYPTION_KEY
      ? { gatewayEncryptionKey: environment.GATEWAY_ENCRYPTION_KEY }
      : {}),
  };
}
