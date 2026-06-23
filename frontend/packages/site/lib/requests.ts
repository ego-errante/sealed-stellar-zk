import type { QueryParams, RequestStatus } from "job-manager";

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

interface RawRequest {
  buyer: string;
  dataset_id: bigint;
  status: { tag: Status };
  params: QueryParams;
  result: bigint;
  k_met: boolean;
  overflow: boolean;
}

/** The slice of the generated JobManager client this enumeration needs. */
export interface JobLike {
  get_request(args: { request_id: bigint }): Promise<{ result: RawRequest }>;
  /** Present after the redeploy that adds it; absent on older deployments. */
  get_request_count?: () => Promise<{ result: bigint }>;
}

function toView(id: bigint, r: RawRequest): RequestView {
  return {
    id,
    buyer: r.buyer,
    datasetId: r.dataset_id,
    status: r.status.tag,
    op: r.params.op,
    targetField: r.params.target_field,
    result: r.result,
    kMet: r.k_met,
    overflow: r.overflow,
    params: r.params,
  };
}

/**
 * Enumerate all requests. Prefers JobManager.get_request_count (deterministic: each poll costs
 * 1 + count reads, and a gap is surfaced as an error rather than silently truncating the list).
 * Falls back to probing get_request(1,2,…) until a not-found trap only when the count method is
 * unavailable (older deployment) — that path is best-effort, which is why the count method is the
 * real fix for "a transient error ends the list early".
 */
export async function enumerateRequests(job: JobLike, maxProbe = 200): Promise<RequestView[]> {
  let count: number | null = null;
  if (typeof job.get_request_count === "function") {
    try {
      count = Number((await job.get_request_count()).result);
    } catch {
      count = null; // method genuinely unavailable → fall back to probing
    }
  }

  const out: RequestView[] = [];

  if (count !== null) {
    for (let i = 1; i <= count; i++) {
      // No catch: a missing id within the known count is a real fault — propagate it so the query
      // errors and retries instead of returning a truncated list.
      const r = (await job.get_request({ request_id: BigInt(i) })).result;
      out.push(toView(BigInt(i), r));
    }
    return out;
  }

  for (let i = 1; i <= maxProbe; i++) {
    try {
      const r = (await job.get_request({ request_id: BigInt(i) })).result;
      out.push(toView(BigInt(i), r));
    } catch {
      break; // no request at this id → end of list (best-effort; see get_request_count above)
    }
  }
  return out;
}
