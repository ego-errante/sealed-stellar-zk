import { describe, expect, it } from "vitest";
import { Buffer } from "buffer";
import { enumerateRequests, type JobLike } from "@/lib/requests";

function rawReq(buyer: string) {
  return {
    buyer,
    dataset_id: 1n,
    status: { tag: "Pending" as const },
    params: {
      op: 3,
      target_field: 0,
      filter_bytecode: Buffer.alloc(0),
      consts: [] as bigint[],
      weights: [] as number[],
    },
    result: 0n,
    k_met: false,
    overflow: false,
  };
}

describe("enumerateRequests", () => {
  it("uses get_request_count when available — deterministic and count-bounded, not 200 probes", async () => {
    let probes = 0;
    const job: JobLike = {
      get_request_count: async () => ({ result: 2n }),
      get_request: async ({ request_id }) => {
        probes++;
        void request_id;
        return { result: rawReq("B") };
      },
    };
    const out = await enumerateRequests(job, 200);
    expect(out.map((r) => Number(r.id))).toEqual([1, 2]);
    expect(probes).toBe(2);
  });

  it("surfaces an error in count mode instead of silently truncating the list", async () => {
    const job: JobLike = {
      get_request_count: async () => ({ result: 2n }),
      get_request: async ({ request_id }) => {
        if (request_id === 2n) throw new Error("RPC timeout");
        return { result: rawReq("B") };
      },
    };
    await expect(enumerateRequests(job, 200)).rejects.toThrow();
  });

  it("falls back to probing until not-found when get_request_count is unavailable", async () => {
    const job: JobLike = {
      get_request: async ({ request_id }) => {
        if (request_id >= 3n) throw new Error("request not found");
        return { result: rawReq("B") };
      },
    };
    const out = await enumerateRequests(job, 200);
    expect(out.map((r) => Number(r.id))).toEqual([1, 2]);
  });
});
