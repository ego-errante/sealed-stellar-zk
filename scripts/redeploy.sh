#!/usr/bin/env bash
# Redeploy DatasetRegistry + JobManager to Stellar testnet after a guest/contract change.
#
# The JobManager binds an immutable guest `image_id`, so any change to the guest ELF
# (i.e. to cdm-shared's journal/agg) requires a fresh JobManager. The Nethermind verifier
# stack (router) is unchanged and reused.
#
# Run inside the toolchain container, which has the Stellar CLI + a funded `deployer` identity
# and the repo mounted at /work:
#   docker exec stellar-zk bash /work/scripts/redeploy.sh
#
# Prereqs: `stellar contract build` has produced the wasm (see below), and the fixtures were
# re-proved with the current guest (their line 2 is the image_id this script binds).
set -euo pipefail

NET=${NET:-testnet}
SRC=${SRC:-deployer}
# Nethermind RiscZeroVerifierRouter on testnet (verifier stack is unchanged across redeploys).
ROUTER=${ROUTER:-CBRBVQP2GOW6FONS4S4Q6BEC53BAJJGWOJRXC4KNDCFJ6WG673MQX633}

WASM_DIR=/work/contracts/target/wasm32v1-none/release
REG_WASM=$WASM_DIR/dataset_registry.wasm
JM_WASM=$WASM_DIR/job_manager.wasm

# image_id the JobManager will bind — taken from the freshly-proved fixture (proof.txt line 2).
IMAGE_ID=$(sed -n '2p' /work/contracts/job-manager/fixtures/count_proof.txt)
echo "image_id   = $IMAGE_ID"
echo "router     = $ROUTER"

echo ">>> deploy DatasetRegistry"
REG=$(stellar contract deploy --wasm "$REG_WASM" --source "$SRC" --network "$NET" 2>/dev/null | tail -1)
echo "registry   = $REG"

echo ">>> deploy JobManager (registry, router, image_id)"
JM=$(stellar contract deploy --wasm "$JM_WASM" --source "$SRC" --network "$NET" \
  -- --registry "$REG" --router "$ROUTER" --image_id "$IMAGE_ID" 2>/dev/null | tail -1)
echo "jobmanager = $JM"

echo ">>> sanity reads"
echo -n "dataset_count = "; stellar contract invoke --id "$REG" --source "$SRC" --network "$NET" -- get_dataset_count 2>/dev/null
echo -n "request_count = "; stellar contract invoke --id "$JM" --source "$SRC" --network "$NET" -- get_request_count 2>/dev/null

# Machine-readable summary for the binding/doc regeneration steps.
echo "REGISTRY=$REG"
echo "JOBMANAGER=$JM"
echo "IMAGE_ID=$IMAGE_ID"
