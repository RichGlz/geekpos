/**
 * Guardián de capas.
 *
 * Reglas verificadas:
 *  1. El SQL de la aplicación vive SOLO en src/repositories y migrations/.
 *     Rutas y servicios no ejecutan consultas directas.
 *  2. Nadie fuera de src/db, src/repositories y scripts/ importa el driver `pg`.
 *
 * Se ejecuta con `npm run lint` y en CI.
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// El migrador es la única excepción: su trabajo es aplicar SQL de migrations/.
// Las pruebas de integración comprueban constraints de PostgreSQL: para eso
// necesitan SQL crudo. Es la única excepción fuera de repositorios.
const SQL_ALLOWED = ["src/repositories", "src/db", "scripts/migrate.ts", "src/__tests__/integration"];
// Las pruebas de integración abren su propio pool contra PostgreSQL real.
const PG_ALLOWED = ["src/db", "src/repositories", "scripts", "src/__tests__/integration"];

const SQL_PATTERN = /\b(SELECT\s+[\s\S]{0,200}?\bFROM\b|INSERT\s+INTO|UPDATE\s+[a-z_]+\s+SET|DELETE\s+FROM)\b/i;
const QUERY_CALL = /\b(pool|client)\s*\.\s*query\s*\(/;
const PG_IMPORT = /from\s+["']pg["']|require\(\s*["']pg["']\s*\)/;

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist") continue;
      files.push(...(await walk(full)));
    } else if (/\.(ts|mts|mjs)$/.test(entry.name)) {
      files.push(full);
    }
  }
  return files;
}

function isUnder(relative, prefixes) {
  return prefixes.some((prefix) => relative === prefix || relative.startsWith(`${prefix}/`));
}

const violations = [];

for (const dir of ["src", "scripts"]) {
  for (const file of await walk(path.join(root, dir))) {
    const relative = path.relative(root, file).split(path.sep).join("/");
    const source = await readFile(file, "utf8");

    if (!isUnder(relative, SQL_ALLOWED)) {
      if (SQL_PATTERN.test(source)) {
        violations.push(`${relative}: contiene SQL fuera de src/repositories`);
      }
      if (QUERY_CALL.test(source)) {
        violations.push(`${relative}: llama a .query() directamente`);
      }
    }

    if (!isUnder(relative, PG_ALLOWED) && PG_IMPORT.test(source)) {
      violations.push(`${relative}: importa el driver "pg" fuera de la capa de datos`);
    }
  }
}

if (violations.length > 0) {
  process.stderr.write("✖ Violaciones de capas:\n");
  for (const violation of violations) process.stderr.write(`  - ${violation}\n`);
  process.exit(1);
}

process.stdout.write("✔ capas correctas: el SQL vive solo en repositorios y migraciones\n");
