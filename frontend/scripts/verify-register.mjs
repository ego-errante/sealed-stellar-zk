// Validates the frontend's WRITE path end-to-end on testnet without Freighter:
// the SAME dataset-registry binding Client + signAndSend the UI uses, signed by a
// freshly-funded key via basicNodeSigner. Proves build → simulate → sign → submit → confirm.
//
//   node scripts/verify-register.mjs
import { Client, networks } from "dataset-registry";
import { Keypair } from "@stellar/stellar-sdk";
import { basicNodeSigner } from "@stellar/stellar-sdk/contract";
import { Server } from "@stellar/stellar-sdk/rpc";

const RPC = "https://soroban-testnet.stellar.org";
const PASSPHRASE = networks.testnet.networkPassphrase;

async function fundAndWait(pubkey) {
  const res = await fetch(`https://friendbot.stellar.org/?addr=${pubkey}`);
  if (!res.ok && res.status !== 400) throw new Error(`friendbot ${res.status}`);
  const server = new Server(RPC);
  for (let i = 0; i < 20; i++) {
    try {
      await server.getAccount(pubkey);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  throw new Error("account never appeared after funding");
}

async function main() {
  const kp = Keypair.random();
  console.log("fresh key:", kp.publicKey());
  await fundAndWait(kp.publicKey());
  console.log("funded ✓");

  const signer = basicNodeSigner(kp, PASSPHRASE);
  const client = new Client({
    rpcUrl: RPC,
    networkPassphrase: PASSPHRASE,
    contractId: networks.testnet.contractId,
    publicKey: kp.publicKey(),
    signTransaction: signer.signTransaction,
  });

  // Reuse dataset #1's root + dims so the new dataset is well-formed.
  const ds1 = (await client.get_dataset({ dataset_id: 1n })).result;
  const before = Number((await client.get_dataset_count()).result);
  console.log("count before:", before);

  const tx = await client.register_dataset({
    owner: kp.publicKey(),
    merkle_root: ds1.merkle_root,
    num_columns: ds1.num_columns,
    row_count: ds1.row_count,
    k: ds1.k,
    cooldown_sec: 0,
  });
  const sent = await tx.signAndSend();
  const newId = sent.result;
  console.log("register_dataset → new id:", newId.toString());

  const after = Number((await client.get_dataset_count()).result);
  console.log("count after:", after);
  const created = (await client.get_dataset({ dataset_id: newId })).result;
  console.log("new dataset owner:", created.owner, "rows:", created.row_count.toString());

  if (after !== before + 1) throw new Error(`count did not increment (${before} → ${after})`);
  if (created.owner !== kp.publicKey()) throw new Error("owner mismatch");
  console.log("\nWRITE PATH OK ✓  (register_dataset signed + submitted + confirmed on testnet)");
}

main().catch((e) => {
  console.error("FAILED:", e.message ?? e);
  process.exit(1);
});
