/**
 * Hook de arranque de Next. El trabajo real vive en instrumentation-node.ts
 * (import dinámico condicionado al runtime para que el bundler edge no
 * intente resolver dependencias de Node como `postgres`).
 */
export async function register(): Promise<void> {
  // Vercel: sin disco que probar, y cada arranque en frío de una función NO es
  // un reinicio del servidor — marcar "huérfanas" las corridas en curso
  // mataría las que otra instancia sigue ejecutando.
  if (process.env.NEXT_RUNTIME === "nodejs" && !process.env.VERCEL) {
    const { checkMediaDir, cleanupOrphanRuns } = await import(
      "./instrumentation-node"
    );
    await checkMediaDir();
    await cleanupOrphanRuns();
  }
}
