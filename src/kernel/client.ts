// Klient RPC workera geometrii (wątek główny).
import type { WorkerRequest, WorkerResponse } from './protocol';

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void };

export class KernelClient {
  private worker: Worker;
  private seq = 0;
  private pending = new Map<number, Pending>();

  constructor() {
    this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (ev: MessageEvent<WorkerResponse>) => {
      const p = this.pending.get(ev.data.id);
      if (!p) return;
      this.pending.delete(ev.data.id);
      if (ev.data.ok) p.resolve(ev.data.result);
      else p.reject(new Error(ev.data.error));
    };
    this.worker.onerror = (ev) => {
      const err = new Error('Błąd workera geometrii: ' + (ev.message || 'nieznany'));
      for (const p of this.pending.values()) p.reject(err);
      this.pending.clear();
    };
  }

  call<T>(req: WorkerRequest, transfer: Transferable[] = []): Promise<T> {
    const id = ++this.seq;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.worker.postMessage({ id, req }, transfer);
    });
  }
}

let client: KernelClient | null = null;
export function kernel(): KernelClient {
  if (!client) client = new KernelClient();
  return client;
}
