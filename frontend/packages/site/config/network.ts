/**
 * Testnet network config. The contract IDs live in each binding's `networks.testnet`;
 * here we keep the RPC + passphrase the frontend needs to build/simulate/submit.
 */
export const TESTNET_PASSPHRASE = "Test SDF Network ; September 2015";
export const SOROBAN_RPC_URL = "https://soroban-testnet.stellar.org";

/**
 * A funded testnet account used purely as the *source* for read-only simulation
 * when no wallet is connected (reads don't require its signature). This is the
 * project's deployer identity.
 */
export const READ_ONLY_SOURCE =
  "GDNPBI646QXUCQ7XXZDX3SSXC6EHCBBZT5LE6BFZYBLDGGGKQFUQZXDY";

/** Owner-local prover-service (the owner runs this on their own machine). */
export const PROVER_URL =
  process.env.NEXT_PUBLIC_PROVER_URL ?? "http://localhost:8787";
