// Freighter via Stellar Wallets Kit (v2.x static SDK API).
//
// The kit registers web components on init, so we load it via dynamic import to keep it out of
// SSR. Its signTransaction returns `{ signedTxXdr, signerAddress? }`, which is exactly the
// `SignTransaction` shape @stellar/stellar-sdk@14 expects — no adapter needed.
//
// DEV SEAM: when NEXT_PUBLIC_DEV_SECRET is set we sign locally with basicNodeSigner instead of
// Freighter, so the full flow is drivable unattended (Playwright / headless). It is OFF by
// default and never set in the demo — production uses Freighter.

import { Keypair } from "@stellar/stellar-sdk";
import { basicNodeSigner } from "@stellar/stellar-sdk/contract";
import { TESTNET_PASSPHRASE } from "@/config/network";

const DEV_SECRET = process.env.NEXT_PUBLIC_DEV_SECRET;
const devKeypair = DEV_SECRET ? Keypair.fromSecret(DEV_SECRET) : null;
const devSigner = devKeypair ? basicNodeSigner(devKeypair, TESTNET_PASSPHRASE) : null;

// ---- Freighter (kit) path -------------------------------------------------

type KitCore = typeof import("@creit.tech/stellar-wallets-kit");
type FreighterMod = typeof import("@creit.tech/stellar-wallets-kit/modules/freighter");
type Kit = {
  StellarWalletsKit: KitCore["StellarWalletsKit"];
  FREIGHTER_ID: string;
};

let kitPromise: Promise<Kit> | null = null;

async function getKit(): Promise<Kit> {
  if (!kitPromise) {
    kitPromise = Promise.all([
      import("@creit.tech/stellar-wallets-kit"),
      import("@creit.tech/stellar-wallets-kit/modules/freighter"),
    ]).then(([core, freighter]: [KitCore, FreighterMod]) => {
      core.StellarWalletsKit.init({
        network: core.Networks.TESTNET,
        selectedWalletId: freighter.FREIGHTER_ID,
        modules: [new freighter.FreighterModule()],
      });
      return {
        StellarWalletsKit: core.StellarWalletsKit,
        FREIGHTER_ID: freighter.FREIGHTER_ID,
      };
    });
  }
  return kitPromise;
}

const LAST_WALLET_KEY = "cdm:lastWallet";

/** Open the wallet modal, connect, and return the chosen address. */
export async function connectWallet(): Promise<string> {
  if (devKeypair) return devKeypair.publicKey();
  const m = await getKit();
  const { address } = await m.StellarWalletsKit.authModal();
  if (typeof window !== "undefined")
    localStorage.setItem(LAST_WALLET_KEY, m.FREIGHTER_ID);
  return address;
}

/** Restore a prior session without a popup, if the wallet still grants access. */
export async function restoreWallet(): Promise<string | null> {
  if (devKeypair) return devKeypair.publicKey();
  if (typeof window === "undefined") return null;
  const last = localStorage.getItem(LAST_WALLET_KEY);
  if (!last) return null;
  try {
    const m = await getKit();
    m.StellarWalletsKit.setWallet(last);
    const { address } = await m.StellarWalletsKit.fetchAddress();
    return address || null;
  } catch {
    return null;
  }
}

export async function disconnectWallet(): Promise<void> {
  if (devKeypair) return;
  if (typeof window !== "undefined") localStorage.removeItem(LAST_WALLET_KEY);
  try {
    const m = await getKit();
    await m.StellarWalletsKit.disconnect();
  } catch {
    /* ignore — we've already cleared local state */
  }
}

/**
 * The signer handed to the SDK (ContractClient options + AssembledTransaction.signAndSend).
 * Returns `{ signedTxXdr, signerAddress }`; falls back to the passed `address` if the wallet
 * omits `signerAddress`.
 */
export async function signTransaction(
  xdr: string,
  opts?: { networkPassphrase?: string; address?: string }
): Promise<{ signedTxXdr: string; signerAddress?: string }> {
  const passphrase = opts?.networkPassphrase ?? TESTNET_PASSPHRASE;
  if (devSigner) {
    const res = await devSigner.signTransaction(xdr, { networkPassphrase: passphrase });
    return { signedTxXdr: res.signedTxXdr, signerAddress: devKeypair!.publicKey() };
  }
  const m = await getKit();
  const res = await m.StellarWalletsKit.signTransaction(xdr, {
    address: opts?.address,
    networkPassphrase: passphrase,
  });
  return { signedTxXdr: res.signedTxXdr, signerAddress: res.signerAddress ?? opts?.address };
}
