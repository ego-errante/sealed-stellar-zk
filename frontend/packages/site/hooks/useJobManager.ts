"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Buffer } from "buffer";
import { useMemo } from "react";
import type { QueryParams, RequestStatus } from "job-manager";
import { makeClients } from "@/lib/clients";
import { useWallet } from "@/hooks/useWallet";

export type Status = RequestStatus["tag"]; // "Pending" | "Accepted" | "Rejected" | "Completed"

export interface RequestView {
  id: bigint;
  buyer: string;
  datasetId: bigint;
  status: Status;
  op: number;
  targetField: number;
  result: bigint;
  kMet: boolean;
  overflow: boolean;
  params: QueryParams;
}

const MAX_PROBE = 200;

/**
 * JobManager has no request count, so enumerate by probing get_request(1,2,3…) until a
 * not-found trap. IDs are sequential with no gaps, so the first failure ends the list.
 */
export function useRequests() {
  const { address } = useWallet();
  const clients = useMemo(() => makeClients(address ?? undefined), [address]);
  return useQuery({
    queryKey: ["requests"],
    refetchInterval: 5000,
    queryFn: async (): Promise<RequestView[]> => {
      const out: RequestView[] = [];
      for (let i = 1; i <= MAX_PROBE; i++) {
        try {
          const r = (await clients.job.get_request({ request_id: BigInt(i) }))
            .result;
          out.push({
            id: BigInt(i),
            buyer: r.buyer,
            datasetId: r.dataset_id,
            status: r.status.tag,
            op: r.params.op,
            targetField: r.params.target_field,
            result: r.result,
            kMet: r.k_met,
            overflow: r.overflow,
            params: r.params,
          });
        } catch {
          break; // no request at this id → end of list
        }
      }
      return out;
    },
  });
}

function useJobClient() {
  const { address } = useWallet();
  const clients = useMemo(() => makeClients(address ?? undefined), [address]);
  return { address, job: clients.job };
}

export function useSubmitRequest() {
  const { address, job } = useJobClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { datasetId: bigint; params: QueryParams }) => {
      if (!address) throw new Error("Connect a wallet first");
      const tx = await job.submit_request({
        buyer: address,
        dataset_id: v.datasetId,
        params: v.params,
      });
      return (await tx.signAndSend()).result;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["requests"] }),
  });
}

export function useAcceptRequest() {
  const { address, job } = useJobClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (requestId: bigint) => {
      if (!address) throw new Error("Connect a wallet first");
      const tx = await job.accept_request({ owner: address, request_id: requestId });
      await tx.signAndSend();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["requests"] }),
  });
}

export function useRejectRequest() {
  const { address, job } = useJobClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (requestId: bigint) => {
      if (!address) throw new Error("Connect a wallet first");
      const tx = await job.reject_request({ owner: address, request_id: requestId });
      await tx.signAndSend();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["requests"] }),
  });
}

export function useFulfill() {
  const { address, job } = useJobClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { requestId: bigint; seal: string; journal: string }) => {
      if (!address) throw new Error("Connect a wallet first");
      const tx = await job.fulfill({
        owner: address,
        request_id: v.requestId,
        seal: Buffer.from(v.seal.replace(/^0x/, ""), "hex"),
        journal: Buffer.from(v.journal.replace(/^0x/, ""), "hex"),
      });
      await tx.signAndSend();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["requests"] }),
  });
}
