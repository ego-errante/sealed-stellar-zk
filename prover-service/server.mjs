// Minimal CDM prover-service (no external deps — Node built-ins only).
//
// Bridges the browser/CLI to the RISC Zero prover, which must run inside the Docker container
// `stellar-zk-full` (it has the docker-out-of-docker setup Groth16 proving needs). We stage input
// files in the shared bind mount `/home/dev/r0work` (same path on host and in the container) and
// shell to the prover binary via `docker exec`.
//
//   POST /register  {csv}          -> {merkle_root, num_columns, row_count}
//   POST /prove     {csv, params}  -> {seal, image_id, journal}   (params = ProveParams object)
//
// Proving takes minutes; /prove holds the connection until the proof is ready. Env overrides:
//   PORT (default 8787), CONTAINER (default stellar-zk-full), WORKDIR (default /home/dev/r0work),
//   BIN (default /work/cdm-guest/target/release/host).
import http from 'node:http';
import { execFile } from 'node:child_process';
import { writeFileSync, readFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';

const PORT = process.env.PORT || 8787;
const CONTAINER = process.env.CONTAINER || 'stellar-zk-full';
const WORKDIR = process.env.WORKDIR || '/home/dev/r0work';
const BIN = process.env.BIN || '/work/cdm-guest/target/release/host';

const run = (args, timeoutMs) =>
  new Promise((resolve, reject) => {
    execFile('docker', ['exec', CONTAINER, ...args], { timeout: timeoutMs, maxBuffer: 1 << 24 },
      (err, stdout, stderr) => (err ? reject(new Error(stderr || err.message)) : resolve(stdout)));
  });

const body = (req) =>
  new Promise((resolve, reject) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => resolve(b));
    req.on('error', reject);
  });

// A client error that maps to an HTTP 4xx instead of the catch-all 500.
class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const badRequest = (m) => new HttpError(400, m);

function parseBody(raw) {
  let obj;
  try {
    obj = JSON.parse(raw);
  } catch {
    throw badRequest('request body is not valid JSON');
  }
  if (obj === null || typeof obj !== 'object') throw badRequest('request body must be a JSON object');
  return obj;
}

function requireCsv(obj) {
  if (typeof obj.csv !== 'string' || obj.csv.trim() === '') {
    throw badRequest('"csv" must be a non-empty string');
  }
  return obj.csv;
}

// stage a file into the shared mount; returns the path (identical on host and container).
function stage(name, contents) {
  const dir = mkdtempSync(join(WORKDIR, 'job-'));
  const p = join(dir, name);
  writeFileSync(p, contents);
  return { dir, p };
}

function parseKV(stdout) {
  const out = {};
  for (const line of stdout.split('\n')) {
    const [k, v] = line.split('\t');
    if (k && v !== undefined) out[k.trim()] = v.trim();
  }
  return out;
}

const server = http.createServer(async (req, res) => {
  const json = (code, obj) => {
    res.writeHead(code, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
    res.end(JSON.stringify(obj));
  };
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'POST, OPTIONS',
      'access-control-allow-headers': 'content-type',
    });
    return res.end();
  }
  try {
    if (req.method === 'POST' && req.url === '/register') {
      const csv = requireCsv(parseBody(await body(req)));
      const { p } = stage('rows.csv', csv);
      const out = parseKV(await run([BIN, 'register', '--data', p], 60_000));
      return json(200, {
        merkle_root: out.merkle_root,
        num_columns: Number(out.num_columns),
        row_count: Number(out.row_count),
      });
    }
    if (req.method === 'POST' && req.url === '/prove') {
      const parsed = parseBody(await body(req));
      const csv = requireCsv(parsed);
      const { params } = parsed;
      if (params === null || typeof params !== 'object') throw badRequest('"params" must be an object');
      const { dir, p } = stage('rows.csv', csv);
      const paramsPath = join(dir, 'params.json');
      writeFileSync(paramsPath, JSON.stringify(params));
      const outPath = join(dir, 'proof.txt');
      await run([BIN, 'prove', '--data', p, '--params', paramsPath, '--out', outPath], 600_000);
      // The CLI writes exactly three lines: seal, image_id, journal. Validate before trusting the
      // split, so a truncated/garbled run becomes a clear 500 instead of returning undefined fields.
      const lines = readFileSync(outPath, 'utf8').trim().split('\n');
      if (lines.length !== 3 || lines.some((l) => l.trim() === '')) {
        throw new Error(`prover output malformed: expected 3 non-empty lines, got ${lines.length}`);
      }
      const [seal, image_id, journal] = lines;
      return json(200, { seal, image_id, journal });
    }
    json(404, { error: 'not found' });
  } catch (e) {
    json(e instanceof HttpError ? e.status : 500, { error: String(e.message || e) });
  }
});

server.listen(PORT, () => console.log(`cdm prover-service on :${PORT} (container=${CONTAINER})`));
