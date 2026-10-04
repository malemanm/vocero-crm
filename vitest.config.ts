import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  // El tsconfig dice `jsx: "preserve"` porque de JSX se encarga Next. Vitest
  // no es Next: sin esto compila el JSX al runtime clásico (`React.
  // createElement` sin importar React) y un componente no se puede dibujar
  // en una prueba (ver tests/unit/switch.test.ts).
  esbuild: { jsx: "automatic" },
  test: {
    include: ["tests/unit/**/*.test.ts"],
    environment: "node",
    // La primera importación de una ruta de Next (que arrastra el esquema, el
    // cliente de BD y los adaptadores) puede pasar de los 5 s por defecto en una
    // máquina cargada o con la caché fría, y entonces el test falla por reloj,
    // no por lógica.
    testTimeout: 20_000,
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
    },
  },
});
