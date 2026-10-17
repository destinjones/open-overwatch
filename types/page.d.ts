// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// For the type check only (tsconfig.json): the one browser name src/core uses outside its workers, src/core/wxload.js
// starting model.worker.js. Declared here alone, so the rest of the WebWorker and DOM names stay unknown to src/core.
declare class Worker {
  constructor(url: string | URL, options?: { type?: 'classic' | 'module' });
  onmessage: ((e: { data: any }) => void) | null;
  onerror: ((e: { message?: string }) => void) | null;
  postMessage(message: any): void;
  terminate(): void;
}
