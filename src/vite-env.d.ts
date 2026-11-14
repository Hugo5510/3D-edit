/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />
declare module 'occt-wasm/dist/occt-wasm.js' {
  const factory: (opts: Record<string, unknown>) => Promise<unknown>;
  export default factory;
}
declare module '@taucad/opencascade.js' {
  const init: (opts?: object) => Promise<unknown>;
  export default init;
}
