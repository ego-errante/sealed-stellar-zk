import { Buffer } from "buffer";
import { Address } from "@stellar/stellar-sdk";
import {
  AssembledTransaction,
  Client as ContractClient,
  ClientOptions as ContractClientOptions,
  MethodOptions,
  Result,
  Spec as ContractSpec,
} from "@stellar/stellar-sdk/contract";
import type {
  u32,
  i32,
  u64,
  i64,
  u128,
  i128,
  u256,
  i256,
  Option,
  Timepoint,
  Duration,
} from "@stellar/stellar-sdk/contract";
export * from "@stellar/stellar-sdk";
export * as contract from "@stellar/stellar-sdk/contract";
export * as rpc from "@stellar/stellar-sdk/rpc";

if (typeof window !== "undefined") {
  //@ts-ignore Buffer exists
  window.Buffer = window.Buffer || Buffer;
}


export const networks = {
  testnet: {
    networkPassphrase: "Test SDF Network ; September 2015",
    contractId: "CBJ4XTOHF2GRCPLYV57HO2E3N6HTGRNNMVZCTTYJ4G6H5SGVRVO6LYS4",
  }
} as const


export interface Dataset {
  cooldown_sec: u32;
  k: u64;
  merkle_root: Buffer;
  num_columns: u32;
  owner: string;
  row_count: u64;
}

export interface Client {
  /**
   * Construct and simulate a get_dataset transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_dataset: ({dataset_id}: {dataset_id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<Dataset>>

  /**
   * Construct and simulate a register_dataset transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  register_dataset: ({owner, merkle_root, num_columns, row_count, k, cooldown_sec}: {owner: string, merkle_root: Buffer, num_columns: u32, row_count: u64, k: u64, cooldown_sec: u32}, options?: MethodOptions) => Promise<AssembledTransaction<u64>>

  /**
   * Construct and simulate a get_dataset_count transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_dataset_count: (options?: MethodOptions) => Promise<AssembledTransaction<u64>>

}
export class Client extends ContractClient {
  static async deploy<T = Client>(
    /** Options for initializing a Client as well as for calling a method, with extras specific to deploying. */
    options: MethodOptions &
      Omit<ContractClientOptions, "contractId"> & {
        /** The hash of the Wasm blob, which must already be installed on-chain. */
        wasmHash: Buffer | string;
        /** Salt used to generate the contract's ID. Passed through to {@link Operation.createCustomContract}. Default: random. */
        salt?: Buffer | Uint8Array;
        /** The format used to decode `wasmHash`, if it's provided as a string. */
        format?: "hex" | "base64";
      }
  ): Promise<AssembledTransaction<T>> {
    return ContractClient.deploy(null, options)
  }
  constructor(public readonly options: ContractClientOptions) {
    super(
      new ContractSpec([ "AAAAAQAAAAAAAAAAAAAAB0RhdGFzZXQAAAAABgAAAAAAAAAMY29vbGRvd25fc2VjAAAABAAAAAAAAAABawAAAAAAAAYAAAAAAAAAC21lcmtsZV9yb290AAAAA+4AAAAgAAAAAAAAAAtudW1fY29sdW1ucwAAAAAEAAAAAAAAAAVvd25lcgAAAAAAABMAAAAAAAAACXJvd19jb3VudAAAAAAAAAY=",
        "AAAAAAAAAAAAAAALZ2V0X2RhdGFzZXQAAAAAAQAAAAAAAAAKZGF0YXNldF9pZAAAAAAABgAAAAEAAAfQAAAAB0RhdGFzZXQA",
        "AAAAAAAAAAAAAAANX19jb25zdHJ1Y3RvcgAAAAAAAAAAAAAA",
        "AAAAAAAAAAAAAAAQcmVnaXN0ZXJfZGF0YXNldAAAAAYAAAAAAAAABW93bmVyAAAAAAAAEwAAAAAAAAALbWVya2xlX3Jvb3QAAAAD7gAAACAAAAAAAAAAC251bV9jb2x1bW5zAAAAAAQAAAAAAAAACXJvd19jb3VudAAAAAAAAAYAAAAAAAAAAWsAAAAAAAAGAAAAAAAAAAxjb29sZG93bl9zZWMAAAAEAAAAAQAAAAY=",
        "AAAAAAAAAAAAAAARZ2V0X2RhdGFzZXRfY291bnQAAAAAAAAAAAAAAQAAAAY=" ]),
      options
    )
  }
  public readonly fromJSON = {
    get_dataset: this.txFromJSON<Dataset>,
        register_dataset: this.txFromJSON<u64>,
        get_dataset_count: this.txFromJSON<u64>
  }
}