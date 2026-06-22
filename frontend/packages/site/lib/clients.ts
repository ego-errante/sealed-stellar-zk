import { Client as RegistryClient, networks as regNet } from "dataset-registry";
import { Client as JobClient, networks as jobNet } from "job-manager";
import { READ_ONLY_SOURCE, SOROBAN_RPC_URL } from "@/config/network";
import { signTransaction } from "@/lib/wallet";

export const REGISTRY_ID = regNet.testnet.contractId;
export const JOB_ID = jobNet.testnet.contractId;

/**
 * Build both contract clients bound to the connected wallet. Reads simulate with
 * `publicKey` as the source account (a placeholder when disconnected); writes route
 * through the kit `signTransaction`. Rebuild whenever the connected address changes.
 */
export function makeClients(publicKey?: string) {
  const common = {
    rpcUrl: SOROBAN_RPC_URL,
    networkPassphrase: regNet.testnet.networkPassphrase,
    publicKey: publicKey ?? READ_ONLY_SOURCE,
    signTransaction,
    allowHttp: false,
  };
  return {
    registry: new RegistryClient({ ...common, contractId: regNet.testnet.contractId }),
    job: new JobClient({ ...common, contractId: jobNet.testnet.contractId }),
  };
}

export type Clients = ReturnType<typeof makeClients>;
