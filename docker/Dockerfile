# Stellar ZK dev environment — keeps RISC Zero + Stellar CLI + project cargo deps
# OFF the host (per global CLAUDE.md: project toolchains live in Docker).
#
# Two stages:
#   --target base : Rust stable + wasm targets + Stellar CLI  (fast; builds/tests Soroban contracts)
#   --target full : base + RISC Zero toolchain (rzup/cargo-risczero/r0vm + native groth16 prover)
#
# Build artifacts go to CARGO_TARGET_DIR=/build-target (inside the container), so the
# bind-mounted /work source tree never accumulates target/ or registry junk.

FROM rust:1-bookworm AS base

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential pkg-config libssl-dev clang cmake git curl jq python3 ca-certificates xz-utils \
      libdbus-1-3 libudev1 \
    && rm -rf /var/lib/apt/lists/*

# Soroban wasm targets (newer soroban-sdk builds to wasm32v1-none; keep the classic one too).
# NOTE: contracts may pin `channel = "stable"` via rust-toolchain.toml, which is a DIFFERENT
# toolchain from the image default — so install the targets on BOTH or the wasm build fails with
# "can't find crate for core". (No `|| true`: a failing target add must break the build, not hide.)
RUN rustup toolchain install stable --profile minimal \
    && rustup target add --toolchain stable wasm32-unknown-unknown wasm32v1-none \
    && rustup target add wasm32-unknown-unknown wasm32v1-none

# Stellar CLI — prebuilt latest x86_64 linux binary (avoids a long source compile)
RUN set -eux; \
    url="$(curl -sSL https://api.github.com/repos/stellar/stellar-cli/releases/latest \
      | jq -r '.assets[] | select(.name|test("x86_64-unknown-linux-gnu.tar.gz$")) | .browser_download_url' | head -n1)"; \
    echo "stellar-cli url: $url"; \
    curl -sSL "$url" -o /tmp/stellar.tar.gz; \
    tar -xzf /tmp/stellar.tar.gz -C /usr/local/bin; \
    rm /tmp/stellar.tar.gz; \
    stellar --version

ENV CARGO_TARGET_DIR=/build-target
WORKDIR /work
CMD ["sleep", "infinity"]

# ----------------------------------------------------------------------------

FROM base AS full

# RISC Zero: rzup installs cargo-risczero, r0vm, and the risc0 rust toolchain.
# risc0-groth16 = native stark->snark prover so we don't need docker-in-docker to prove.
ENV PATH="/root/.risc0/bin:${PATH}"
RUN curl -L https://risczero.com/install | bash \
    && rzup install \
    && rzup install risc0-groth16

CMD ["sleep", "infinity"]
