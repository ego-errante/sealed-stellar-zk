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
      const { csv } = JSON.parse(await body(req));
      const { p } = stage('rows.csv', csv);
      const out = parseKV(await run([BIN, 'register', '--data', p], 60_000));
      return json(200, {
        merkle_root: out.merkle_root,
        num_columns: Number(out.num_columns),
        row_count: Number(out.row_count),
      });
    }
    if (req.method === 'POST' && req.url === '/prove') {
      const { csv, params } = JSON.parse(await body(req));
      const { dir, p } = stage('rows.csv', csv);
      const paramsPath = join(dir, 'params.json');
      writeFileSync(paramsPath, JSON.stringify(params));
      const outPath = join(dir, 'proof.txt');
      await run([BIN, 'prove', '--data', p, '--params', paramsPath, '--out', outPath], 600_000);
      const [seal, image_id, journal] = readFileSync(outPath, 'utf8').trim().split('\n');
      return json(200, { seal, image_id, journal });
    }
    json(404, { error: 'not found' });
  } catch (e) {
    json(500, { error: String(e.message || e) });
  }
});

server.listen(PORT, () => console.log(`cdm prover-service on :${PORT} (container=${CONTAINER})`));
