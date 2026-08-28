import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Geeksium POS — Estado del proyecto" },
      {
        name: "description",
        content:
          "Portal de estado del desarrollo de Geeksium POS: avance por módulos, arquitectura Vue 3 + Fastify y comandos de ejecución.",
      },
      { property: "og:title", content: "Geeksium POS — Estado del proyecto" },
      {
        property: "og:description",
        content:
          "Avance del punto de venta multiempresa Geeksium POS: base de seguridad, licenciamiento y módulos pendientes.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

type Status = "listo" | "en curso" | "pendiente";

const statusStyles: Record<Status, string> = {
  listo: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  "en curso": "bg-amber-500/15 text-amber-300 border-amber-500/30",
  pendiente: "bg-slate-500/15 text-slate-300 border-slate-500/30",
};

const modules: { name: string; detail: string; status: Status }[] = [
  { name: "Base multiempresa", detail: "Organizaciones, sucursales y almacenes aislados por organización", status: "listo" },
  { name: "Autenticación", detail: "Argon2id, refresh rotativo con detección de reúso y bloqueo temporal", status: "listo" },
  { name: "Sesiones y auditoría", detail: "Listado y cierre de sesiones, bitácora de eventos de seguridad", status: "listo" },
  { name: "Licenciamiento", detail: "Estados activa / por vencer / solo lectura aplicados en el servidor", status: "listo" },
  { name: "Interfaz Vue 3", detail: "Landing, login, layout desktop-first y PWA con service worker", status: "listo" },
  { name: "Punto de venta", detail: "Cobro, formas de pago y tickets", status: "pendiente" },
  { name: "Inventario y unidades", detail: "Existencias por almacén, unidades de compra y venta", status: "pendiente" },
  { name: "Traspasos con saldo", detail: "Envíos parciales y saldo pendiente entre almacenes", status: "pendiente" },
  { name: "Operación offline", detail: "Cola local en IndexedDB probada; falta el reenvío automático al reconectar", status: "en curso" },
  { name: "Estabilización Ronda 1", detail: "Integridad SQL multiempresa, rotación concurrente y PWA verificadas con PostgreSQL real y navegador", status: "listo" },
];

const commands = [
  { label: "API — instalar y migrar", value: "cd api && npm install && npm run migrate" },
  { label: "API — datos de desarrollo", value: "cd api && npm run seed:dev" },
  { label: "API — servidor", value: "cd api && npm run dev" },
  { label: "Vue — aplicación", value: "cd vue-app && npm install && npm run dev" },
];

function Index() {
  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-5xl px-6 py-16">
        <p className="text-xs uppercase tracking-[0.3em] text-emerald-400">Portal interno</p>
        <h1 className="mt-3 text-4xl font-semibold">Geeksium POS — estado del proyecto</h1>
        <p className="mt-4 max-w-2xl text-slate-400">
          Esta página es el tablero de avance. El producto real es la aplicación Vue 3 en{" "}
          <code className="rounded bg-slate-800 px-1.5 py-0.5 text-slate-200">/vue-app</code> con su
          API Fastify en{" "}
          <code className="rounded bg-slate-800 px-1.5 py-0.5 text-slate-200">/api</code>, que se
          ejecutan localmente con los comandos de abajo.
        </p>

        <section className="mt-12">
          <h2 className="text-xl font-semibold">Módulos</h2>
          <ul className="mt-4 space-y-2">
            {modules.map((module) => (
              <li
                key={module.name}
                className="flex items-start justify-between gap-6 rounded-lg border border-slate-800 bg-slate-900/60 p-4"
              >
                <div>
                  <p className="font-medium">{module.name}</p>
                  <p className="text-sm text-slate-400">{module.detail}</p>
                </div>
                <span
                  className={`shrink-0 rounded-full border px-3 py-1 text-xs ${statusStyles[module.status]}`}
                >
                  {module.status}
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section className="mt-12">
          <h2 className="text-xl font-semibold">Comandos de ejecución</h2>
          <dl className="mt-4 space-y-3">
            {commands.map((command) => (
              <div key={command.label} className="rounded-lg border border-slate-800 bg-slate-900/60 p-4">
                <dt className="text-sm text-slate-400">{command.label}</dt>
                <dd className="mt-1 font-mono text-sm text-emerald-300">{command.value}</dd>
              </div>
            ))}
          </dl>
        </section>

        <p className="mt-12 text-sm text-slate-500">
          Documentación completa en <code>/docs</code>: PRD, arquitectura, seguridad, puesta en marcha e
          informe de la Ronda 1 de estabilización.
        </p>
      </div>
    </main>
  );
}
