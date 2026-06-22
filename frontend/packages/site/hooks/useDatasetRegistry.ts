"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Buffer } from "buffer";
import { useMemo } from "react";
import { makeClients } from "@/lib/clients";
import { useWallet } from "@/hooks/useWallet";

/** A dataset flattened for the UI (ids start at 1). */
export interface DatasetView {
  id: bigint;
  owner: string;
  merkleRoot: string; // hex
  numColumns: number;
  rowCount: bigint;
  k: bigint;
  cooldownSec: number;
}

export function useDatasetCount() {
  const { address } = useWallet();
  const clients = useMemo(() => makeClients(address ?? undefined), [address]);
  return useQuery({
    queryKey: ["datasetCount"],
    queryFn: async () =>
      Number((await clients.registry.get_dataset_count()).result),
  });
}

export function useDatasets() {
  const { address } = useWallet();
  const clients = useMemo(() => makeClients(address ?? undefined), [address]);
  const count = useDatasetCount();

  const datasets = useQuery({
    queryKey: ["datasets", count.data],
    enabled: count.data !== undefined,
    queryFn: async (): Promise<DatasetView[]> => {
      const n = count.data ?? 0;
      const ids = Array.from({ length: n }, (_, i) => BigInt(i + 1));
      return Promise.all(
        ids.map(async (id) => {
          const ds = (await clients.registry.get_dataset({ dataset_id: id }))
            .result;
          return {
            id,
            owner: ds.owner,
            merkleRoot: Buffer.from(ds.merkle_root).toString("hex"),
            numColumns: ds.num_columns,
            rowCount: ds.row_count,
            k: ds.k,
            cooldownSec: ds.cooldown_sec,
          };
        })
      );
    },
  });

  return { count, datasets };
}

export interface RegisterInput {
  merkleRoot: string; // hex (with or without 0x)
  numColumns: number;
  rowCount: number;
  k: number;
  cooldownSec: number;
}

/** Register a dataset: signs + submits register_dataset; returns the new dataset id. */
export function useRegisterDataset() {
  const { address } = useWallet();
  const qc = useQueryClient();
  const clients = useMemo(() => makeClients(address ?? undefined), [address]);

  return useMutation({
    mutationFn: async (input: RegisterInput): Promise<bigint> => {
      if (!address) throw new Error("Connect a wallet first");
      const tx = await clients.registry.register_dataset({
        owner: address,
        merkle_root: Buffer.from(input.merkleRoot.replace(/^0x/, ""), "hex"),
        num_columns: input.numColumns,
        row_count: BigInt(input.rowCount),
        k: BigInt(input.k),
        cooldown_sec: input.cooldownSec,
      });
      const sent = await tx.signAndSend();
      return sent.result;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["datasetCount"] });
      qc.invalidateQueries({ queryKey: ["datasets"] });
    },
  });
}
