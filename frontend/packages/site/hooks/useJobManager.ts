"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Buffer } from "buffer";
import { useMemo } from "react";
import type { QueryParams } from "job-manager";
import { makeClients } from "@/lib/clients";
import { useWallet } from "@/hooks/useWallet";
import { enumerateRequests, type JobLike } from "@/lib/requests";

export type { RequestView, Status } from "@/lib/requests";

/**
 * Enumerate requests via the shared {@link enumerateRequests} helper, which prefers
 * JobManager.get_request_count (deterministic, count-bounded) and only falls back to probing.
 * Polling is paused while the tab is backgrounded so it doesn't hammer the public RPC.
 */
export function useRequests() {
  const { address } = useWallet();
  const clients = useMemo(() => makeClients(address ?? undefined), [address]);
  return useQuery({
    queryKey: ["requests"],
    refetchInterval: 5000,
    refetchIntervalInBackground: false,
    queryFn: () => enumerateRequests(clients.job as unknown as JobLike),
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
