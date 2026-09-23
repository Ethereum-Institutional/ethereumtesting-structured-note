# The hosted chain needs anvil and a state snapshot -- nothing else.
#
# The snapshot was produced by ops/bake-state.sh, which ran the full Foundry + Hardhat
# deployment locally and dumped the result. None of that toolchain is needed here, which keeps
# this image small and the startup instant.
FROM ghcr.io/foundry-rs/foundry:stable

USER root
WORKDIR /chain
COPY anvil-state.json /chain/anvil-state.json
RUN chown -R foundry:foundry /chain
USER foundry

EXPOSE 8545

# Auto-mine rather than a fixed block time: blocks are produced only when a transaction
# arrives, so an idle demo chain does not accumulate empty blocks or burn CPU.
#
# A restart reloads the snapshot, discarding anything done since. That is deliberate: it makes
# a machine restart equivalent to a clean demo reset.
ENTRYPOINT ["anvil"]
CMD ["--host", "0.0.0.0", \
     "--port", "8545", \
     "--chain-id", "31337", \
     "--load-state", "/chain/anvil-state.json"]
