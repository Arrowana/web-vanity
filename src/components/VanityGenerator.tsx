import { useState, useCallback } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { PublicKey, Keypair } from "@solana/web3.js";
import {
  VanityWorker,
  type VanityOptions,
  type VanityResult,
} from "../lib/vanity";
import { createMintFromVanityAddress } from "../lib/mint";

export const VanityGenerator = () => {
  const { publicKey, connected, sendTransaction } = useWallet();
  const { connection } = useConnection();

  const [prefix, setPrefix] = useState("");
  const [suffix, setSuffix] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [result, setResult] = useState<VanityResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<number>(0);
  const [totalAttempts, setTotalAttempts] = useState<number>(0);
  const [elapsedTime, setElapsedTime] = useState<number>(0);
  const [addressesPerSecond, setAddressesPerSecond] = useState<number>(0);
  const [numWorkers, setNumWorkers] = useState<number>(
    navigator.hardwareConcurrency || 4
  );
  const [isMinting, setIsMinting] = useState(false);
  const [mintSignature, setMintSignature] = useState<string | null>(null);
  const [vanityWorker, setVanityWorker] = useState<VanityWorker | null>(null);

  const generateAddress = useCallback(async () => {
    if (!prefix && !suffix) {
      setError("Please enter a prefix or suffix");
      return;
    }

    setIsGenerating(true);
    setError(null);
    setResult(null);
    setProgress(0);
    setTotalAttempts(0);
    setElapsedTime(0);
    setAddressesPerSecond(0);

    try {
      const baseKeyPair = Keypair.generate();
      const ownerPubkey = publicKey || baseKeyPair.publicKey; // Use connected wallet or generated keypair

      const options: VanityOptions = {
        prefix: prefix || undefined,
        suffix: suffix || undefined,
        caseSensitive,
        maxAttempts: 1000000,
      };

      // Create and start worker
      const worker = new VanityWorker(numWorkers);
      setVanityWorker(worker);

      const startTime = Date.now();
      const timerId = setInterval(() => {
        setElapsedTime((Date.now() - startTime) / 1000);
      }, 250);

      const vanityResult = await worker.generate(
        baseKeyPair.publicKey,
        ownerPubkey,
        options,
        (attempts) => {
          setTotalAttempts(attempts);

          // Calculate addresses per second
          const currentElapsed = (Date.now() - startTime) / 1000;
          const currentSpeed =
            currentElapsed > 0 ? attempts / currentElapsed : 0;
          setAddressesPerSecond(currentSpeed);

          // Calculate progress based on attempts (rough estimate)
          const estimatedProgress = Math.min((attempts / 100000) * 100, 95);
          setProgress(estimatedProgress);
        },
        timerId
      );

      clearInterval(timerId);

      // Verify the result using PublicKey.createWithSeed
      try {
        const verifiedPubkey = await PublicKey.createWithSeed(
          baseKeyPair.publicKey,
          vanityResult.seed,
          ownerPubkey
        );
        
        if (verifiedPubkey.toBase58() !== vanityResult.address) {
          throw new Error(`Verification failed: expected ${vanityResult.address}, got ${verifiedPubkey.toBase58()}`);
        }
        
        console.log("✅ Vanity address verified successfully!");
      } catch (verifyError) {
        console.error("❌ Verification failed:", verifyError);
        setError(verifyError instanceof Error ? verifyError.message : "Address verification failed");
        return;
      }

      setProgress(100);
      setResult(vanityResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Generation failed");
    } finally {
      setIsGenerating(false);

      if (vanityWorker) {
        vanityWorker.stop();
        setVanityWorker(null);
      }
    }
  }, [publicKey?.toBase58(), prefix, suffix, caseSensitive, vanityWorker]);

  const createMint = useCallback(async () => {
    if (!publicKey || !result || !sendTransaction) {
      setError("Missing requirements for mint creation");
      return;
    }

    setIsMinting(true);
    setError(null);
    setMintSignature(null);

    try {
      const vanityPubkey = new PublicKey(result.address);
      const mintTransaction = await createMintFromVanityAddress(
        connection,
        publicKey,
        vanityPubkey,
        result.seed
      );

      const signature = await sendTransaction(mintTransaction, connection);
      await connection.confirmTransaction(signature);

      setMintSignature(signature);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Mint creation failed");
    } finally {
      setIsMinting(false);
    }
  }, [publicKey, result, sendTransaction, connection]);

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-6">
      <div className="text-center">
        <h1 className="text-3xl font-bold mb-2">
          Solana Vanity Address Generator
        </h1>
        <p className="text-gray-600">
          Generate custom Solana addresses with your desired prefix or suffix
        </p>
      </div>

      <div className="bg-white rounded-lg shadow-md p-6">
        <div className="mb-6">
          <WalletMultiButton />
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-2">Prefix</label>
            <input
              type="text"
              value={prefix}
              onChange={(e) => setPrefix(e.target.value)}
              className="w-full p-2 border rounded-md"
              placeholder="e.g., ABC"
              disabled={isGenerating}
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Suffix</label>
            <input
              type="text"
              value={suffix}
              onChange={(e) => setSuffix(e.target.value)}
              className="w-full p-2 border rounded-md"
              placeholder="e.g., XYZ"
              disabled={isGenerating}
            />
          </div>

          <div className="flex items-center">
            <input
              type="checkbox"
              checked={caseSensitive}
              onChange={(e) => setCaseSensitive(e.target.checked)}
              className="mr-2"
              disabled={isGenerating}
            />
            <label className="text-sm">Case sensitive</label>
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">
              Workers ({navigator.hardwareConcurrency || 4} CPU cores detected)
            </label>
            <input
              type="range"
              min="1"
              max={20}
              value={numWorkers}
              onChange={(e) => setNumWorkers(Number(e.target.value))}
              className="w-full"
              disabled={isGenerating}
            />
            <div className="flex justify-between text-xs text-gray-500 mt-1">
              <span className="font-medium">{numWorkers} workers</span>
            </div>
          </div>

          {!isGenerating ? (
            <button
              onClick={generateAddress}
              disabled={!prefix && !suffix}
              className="w-full bg-blue-500 text-white py-2 px-4 rounded-md hover:bg-blue-600 disabled:bg-gray-400 disabled:cursor-not-allowed"
            >
              Generate Vanity Address
            </button>
          ) : (
            <button
              onClick={() => {
                if (vanityWorker) {
                  vanityWorker.stop();
                  setVanityWorker(null);
                }
                setIsGenerating(false);
                setProgress(0);
                setTotalAttempts(0);
                setElapsedTime(0);
                setAddressesPerSecond(0);
              }}
              className="w-full bg-red-500 text-white py-2 px-4 rounded-md hover:bg-red-600"
            >
              Stop Generation
            </button>
          )}

          {isGenerating && (
            <div className="space-y-2">
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div
                  className="bg-blue-500 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <p className="text-sm text-gray-600 text-center">
                Searching for vanity address... {Math.round(progress)}%
              </p>
              <div className="text-xs text-gray-500 text-center space-y-1">
                <p>{totalAttempts.toLocaleString()} addresses checked</p>
                <p>
                  ⏱️ {Math.floor(elapsedTime / 60)}:
                  {String(Math.floor(elapsedTime % 60)).padStart(2, "0")}.
                  {Math.floor((elapsedTime % 1) * 10)} elapsed
                </p>
                <p>
                  🚀 {Math.floor(addressesPerSecond).toLocaleString()}{" "}
                  addresses/sec
                </p>
                <p>👥 {numWorkers} workers active</p>
              </div>
            </div>
          )}

          {error && (
            <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded">
              {error}
            </div>
          )}

          {result && (
            <div className="bg-green-100 border border-green-400 text-green-700 px-4 py-3 rounded space-y-2">
              <h3 className="font-semibold">Vanity Address Found!</h3>
              <div className="space-y-1 text-sm">
                <p>
                  <strong>Address:</strong>{" "}
                  <code className="bg-green-50 px-1 rounded">
                    {result.address}
                  </code>
                </p>
                <p>
                  <strong>Seed:</strong>{" "}
                  <code className="bg-green-50 px-1 rounded">
                    {result.seed}
                  </code>
                </p>
                <p>
                  <strong>Attempts:</strong> {result.attempts.toLocaleString()}
                </p>
                <p>
                  <strong>Time:</strong> {Math.floor(elapsedTime / 60)}:
                  {String(Math.floor(elapsedTime % 60)).padStart(2, "0")}.
                  {Math.floor((elapsedTime % 1) * 10)}
                </p>
                <p>
                  <strong>Speed:</strong>{" "}
                  {Math.floor(addressesPerSecond).toLocaleString()}{" "}
                  addresses/sec
                </p>
                {/* {result.timing && (
                  <div className="text-xs text-gray-600 mt-2">
                    <p>
                      <strong>Final Performance:</strong>
                    </p>
                    <div className="grid grid-cols-2 gap-1">
                      <span>
                        Seed gen: {result.timing.seedGenAvg.toFixed(3)}ms
                      </span>
                      <span>SHA256: {result.timing.hashAvg.toFixed(3)}ms</span>
                      <span>
                        Base58: {result.timing.encodeAvg.toFixed(3)}ms
                      </span>
                      <span>Match: {result.timing.matchAvg.toFixed(3)}ms</span>
                    </div>
                  </div>
                )} */}
              </div>

              {connected && (
                <div className="mt-4">
                  <button
                    onClick={createMint}
                    disabled={isMinting}
                    className="w-full bg-green-600 text-white py-2 px-4 rounded-md hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
                  >
                    {isMinting
                      ? "Creating Mint..."
                      : "Create Mint from Vanity Address"}
                  </button>
                </div>
              )}

              {mintSignature && (
                <div className="bg-blue-100 border border-blue-400 text-blue-700 px-4 py-3 rounded">
                  <p className="font-semibold">Mint Created Successfully!</p>
                  <p className="text-sm">
                    <strong>Transaction:</strong>{" "}
                    <a
                      href={`https://explorer.solana.com/tx/${mintSignature}?cluster=devnet`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline hover:text-blue-800"
                    >
                      {mintSignature.slice(0, 8)}...{mintSignature.slice(-8)}
                    </a>
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        {!connected && result && (
          <div className="mt-4 bg-yellow-100 border border-yellow-400 text-yellow-700 px-4 py-3 rounded">
            <p className="text-sm">
              Connect your wallet to create a mint for a vanity address
            </p>
          </div>
        )}
      </div>
    </div>
  );
};
