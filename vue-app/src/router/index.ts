import { createRouter, createWebHistory, type RouteRecordRaw } from "vue-router";
import { useAuthStore } from "@/modules/auth/auth.store";

/**
 * Los guards de router son solo experiencia de usuario: evitan pantallas
 * vacías. La autorización real la impone el servidor en cada endpoint.
 */
const routes: RouteRecordRaw[] = [
  {
    path: "/",
    name: "landing",
    component: () => import("@/views/LandingView.vue"),
    meta: { public: true },
  },
  {
    path: "/login",
    name: "login",
    component: () => import("@/views/LoginView.vue"),
    meta: { public: true, guestOnly: true },
  },
  {
    path: "/app",
    component: () => import("@/layouts/AppLayout.vue"),
    children: [
      { path: "", name: "dashboard", component: () => import("@/views/DashboardView.vue") },
      { path: "pos", name: "pos", component: () => import("@/views/PlaceholderView.vue"), meta: { title: "Punto de venta" } },
      { path: "inventario", name: "inventory", component: () => import("@/views/PlaceholderView.vue"), meta: { title: "Inventario" } },
      { path: "traspasos", name: "transfers", component: () => import("@/views/PlaceholderView.vue"), meta: { title: "Traspasos" } },
      { path: "catalogo", name: "catalog", component: () => import("@/views/PlaceholderView.vue"), meta: { title: "Catálogo" } },
      { path: "sesiones", name: "sessions", component: () => import("@/views/SessionsView.vue"), meta: { title: "Sesiones activas" } },
    ],
  },
  { path: "/:pathMatch(.*)*", name: "not-found", component: () => import("@/views/NotFoundView.vue"), meta: { public: true } },
];

export const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior: () => ({ top: 0 }),
});

router.beforeEach(async (to) => {
  const auth = useAuthStore();
  // Si se navega antes de terminar el arranque, se espera a la restauración de
  // sesión: de lo contrario una recarga en ruta privada rebotaría al login.
  if (!auth.ready) await auth.bootstrap();
  if (to.meta["guestOnly"] && auth.isAuthenticated) return { name: "dashboard" };
  if (!to.meta["public"] && !auth.isAuthenticated) {
    return { name: "login", query: { redirect: to.fullPath } };
  }
  return true;
});
