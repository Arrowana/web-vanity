import { PublicKey } from "@solana/web3.js";

export interface VanityOptions {
  prefix?: string;
  suffix?: string;
  caseSensitive?: boolean;
  maxAttempts?: number;
}

export interface VanityResult {
  address: string;
  seed: string;
  attempts: number;
  timing?: {
    seedGenAvg: number;
    hashAvg: number;
    encodeAvg: number;
    matchAvg: number;
  };
}

// Worker-based parallel generation
export class VanityWorker {
  private workers: Worker[] = [];
  private running = false;
  private onProgressCallback?: (totalAttempts: number, timing?: any) => void;
  private timerId?: NodeJS.Timeout;

  constructor(
    private numWorkers: number = navigator.hardwareConcurrency || 4
  ) {}

  async generate(
    basePubkey: PublicKey,
    ownerPubkey: PublicKey,
    options: VanityOptions = {},
    onProgress?: (totalAttempts: number, timing?: any) => void,
    timerId?: NodeJS.Timeout
  ): Promise<VanityResult> {
    return new Promise((resolve, reject) => {
      this.running = true;
      this.onProgressCallback = onProgress;
      this.timerId = timerId;
      let totalAttempts = 0;
      const workerAttempts = new Map<number, number>();

      const cleanup = () => {
        this.running = false;
        if (this.timerId) {
          clearInterval(this.timerId);
          this.timerId = undefined;
        }
        // Send stop message to workers before terminating
        this.workers.forEach((worker) => {
          worker.postMessage({ type: "stop" });
          worker.terminate();
        });
        this.workers = [];
      };

      // Create workers
      for (let i = 0; i < this.numWorkers; i++) {
        workerAttempts.set(i, 0);
        const worker = new Worker(
          new URL("../workers/wasm-vanity-worker.ts", import.meta.url),
          { type: "module" }
        );
        console.log("Start worker");

        worker.onmessage = (e) => {
          const { type, address, seed, attempts, workerId, timing } = e.data;

          if (type === "found") {
            cleanup();
            resolve({
              address,
              seed,
              attempts: totalAttempts + attempts,
              timing,
            });
          } else if (type === "progress") {
            workerAttempts.set(workerId, attempts);
            totalAttempts = Array.from(workerAttempts.values()).reduce(
              (sum, val) => sum + val,
              0
            );

            if (this.onProgressCallback) {
              this.onProgressCallback(totalAttempts, timing);
            }
          } else if (type === "error") {
            cleanup();
            reject(new Error(e.data.message || "Worker error"));
          }
        };

        worker.onerror = (error) => {
          cleanup();
          reject(new Error("Worker error: " + error.message));
        };

        worker.postMessage({
          baseBytes: Array.from(basePubkey.toBytes()),
          ownerBytes: Array.from(ownerPubkey.toBytes()),
          prefix: options.prefix,
          suffix: options.suffix,
          caseSensitive: options.caseSensitive || false,
          workerId: i,
        });

        this.workers.push(worker);
      }

      // Timeout after reasonable time
      setTimeout(() => {
        if (this.running) {
          cleanup();
          reject(new Error("Generation timeout after 5 minutes"));
        }
      }, 300000); // 5 minutes
    });
  }

  stop() {
    this.running = false;
    if (this.timerId) {
      clearInterval(this.timerId);
      this.timerId = undefined;
    }
    // Send stop message to workers before terminating
    this.workers.forEach((worker) => {
      worker.postMessage({ type: "stop" });
      worker.terminate();
    });
    this.workers = [];
  }
}
