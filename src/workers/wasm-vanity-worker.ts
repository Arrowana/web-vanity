import init, { VanitySearcher } from "../../rust-vanity/pkg/rust_vanity.js";

let wasmInitialized = false;
let searcher: VanitySearcher | null = null;
let shouldStop = false;

async function initWasm() {
  if (!wasmInitialized) {
    await init();
    wasmInitialized = true;
  }
}

self.onmessage = async function (e) {
  if (e.data.type === "stop") {
    shouldStop = true;
    if (searcher) {
      searcher.stop();
    }
    return;
  }

  const { baseBytes, ownerBytes, prefix, suffix, caseSensitive, workerId } =
    e.data;

  try {
    await initWasm();

    shouldStop = false;
    const startTime = Date.now();
    let reportedAttempts = 0;

    const base = new Uint8Array(baseBytes);
    const owner = new Uint8Array(ownerBytes);

    // Generate random offset for this worker to avoid overlap
    const countOffset = BigInt(Math.floor(Math.random() * 1000000000));

    searcher = new VanitySearcher(
      base,
      owner,
      prefix || undefined,
      suffix || undefined,
      !caseSensitive,
      countOffset
    );

    const batchSize = 250_000; // Process in batches to allow progress reporting

    while (!shouldStop) {
      const result = searcher.search_batch(batchSize);
      const currentAttempts = Number(searcher.attempts);

      if (result) {
        const timeSecs = (Date.now() - startTime) / 1000;

        self.postMessage({
          type: "found",
          address: result.address,
          seed: result.seed,
          attempts: Number(result.attempts),
          workerId,
          timeSecs,
          timing: {
            // WASM doesn't provide detailed timing yet
            totalAvg: (timeSecs * 1000) / Number(result.attempts),
          },
        });
        return;
      }

      // Send progress updates
      if (currentAttempts - reportedAttempts >= 1000) {
        reportedAttempts = currentAttempts;
        self.postMessage({
          type: "progress",
          attempts: currentAttempts,
          workerId,
          timing: {
            totalAvg: ((Date.now() - startTime) * 1000) / currentAttempts,
          },
        });
      }

      // Yield control periodically
      if (currentAttempts % 10000 === 0) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }
  } catch (error: any) {
    self.postMessage({
      type: "error",
      message: error.message || "WASM worker error",
      workerId,
    });
  }
};
