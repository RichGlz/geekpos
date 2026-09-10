import "dotenv/config";
import { z } from "zod";

/**
 * Configuración por variables de entorno, validada al arrancar.
 * Si algo falta o es inseguro, el proceso NO arranca.
 */
const booleanish = z
  .union([z.boolean(), z.enum(["true", "false", "1", "0", ""])])
  .transform((v) => v === true || v === "true" || v === "1");

const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().int().positive().default(3000),
    HOST: z.string().default("0.0.0.0"),
    LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),

    DATABASE_URL: z.string().min(1, "DATABASE_URL es obligatorio"),
    DATABASE_SSL: booleanish.default(false),
    SUPABASE_STORAGE_URL: z.string().url().optional(),
    SUPABASE_STORAGE_KEY: z.string().min(1).optional(),
    SUPABASE_STORAGE_BUCKET: z.string().min(1).default("gkspos-buk"),
    APP_VERSION: z.string().regex(/^\d+\.\d+\.\d+$/).default("0.2.0"),
    APP_MINIMUM_VERSION: z.string().regex(/^\d+\.\d+\.\d+$/).default("0.1.0"),
    APP_UPDATE_CHANNEL: z.enum(["development", "pilot", "stable"]).default("stable"),

    JWT_SECRET: z.string().min(32, "JWT_SECRET debe tener al menos 32 caracteres"),
    ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().max(3600).default(900),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().max(365).default(30),

    COOKIE_SECURE: booleanish.default(true),
    COOKIE_SAMESITE: z.enum(["lax", "strict", "none"]).default("lax"),
    COOKIE_DOMAIN: z.string().optional(),

    CORS_ORIGINS: z.string().default(""),

    LOGIN_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
    LOGIN_WINDOW_SECONDS: z.coerce.number().int().positive().default(900),
    LOGIN_LOCK_MAX_SECONDS: z.coerce.number().int().positive().default(900),
  })
  .superRefine((value, ctx) => {
    // Regla dura: en producción la cookie de refresh SIEMPRE es Secure.
    if (value.NODE_ENV === "production" && !value.COOKIE_SECURE) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["COOKIE_SECURE"],
        message: "COOKIE_SECURE debe ser true en producción",
      });
    }
    if (value.COOKIE_SAMESITE === "none" && !value.COOKIE_SECURE) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["COOKIE_SAMESITE"],
        message: "SameSite=None exige Secure=true",
      });
    }
  });

export type AppEnv = z.infer<typeof envSchema> & {
  corsOrigins: string[];
  isProduction: boolean;
  isTest: boolean;
};

export function loadEnv(source: NodeJS.ProcessEnv = process.env): AppEnv {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Configuración de entorno inválida:\n${detail}`);
  }
  const value = parsed.data;
  return {
    ...value,
    corsOrigins: value.CORS_ORIGINS.split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
    isProduction: value.NODE_ENV === "production",
    isTest: value.NODE_ENV === "test",
  };
}
