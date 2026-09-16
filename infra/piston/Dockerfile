# Custom Piston image with CampusTrack's language runtimes pre-installed at
# build time, so a fresh container is ready to execute code the moment it
# passes its healthcheck — no first-boot download via a piston-init service.
#
# Each language installs in its OWN build stage (see install-* below) so
# BuildKit builds them concurrently instead of one long serial RUN — the
# bottleneck here is downloading+extracting 5 independent runtime tarballs,
# which parallelizes cleanly since they don't depend on each other. The
# final stage just collects each stage's /piston/packages/<lang> directory.
# Splitting this way also means changing one language's version only
# invalidates that language's cached layer, not all five.
#
# Keep this list in sync with LANGUAGE_MAP in backend/src/services/piston.js
# and with scripts/install-packages.sh (kept as a manual fallback for
# installing an extra language onto a running stack without a rebuild).
#
# --platform=linux/amd64 is explicit on purpose: ghcr.io/engineer-man/piston
# is only published for amd64 (isolate's cgroup/seccomp sandboxing has no
# arm64 build upstream). Production runs on a standard x86_64 Linux host, so
# this is native there. On Apple Silicon it runs under Docker's amd64
# emulation regardless — pinning it here just makes that explicit instead of
# relying on an implicit platform-mismatch fallback (and the warning that
# comes with it) on every build.
FROM --platform=linux/amd64 ghcr.io/engineer-man/piston:latest AS base
# At container runtime, docker-compose's piston_packages volume mount
# auto-creates /piston/packages before the process starts. At `docker
# build` time there's no volume, so /piston doesn't exist yet in the base
# image and the API's config validation refuses to start without it.
RUN mkdir -p /piston/packages
COPY scripts/bake-package.sh /tmp/bake-package.sh
RUN chmod +x /tmp/bake-package.sh

FROM base AS install-python
RUN /tmp/bake-package.sh python 3.10.0

FROM base AS install-node
RUN /tmp/bake-package.sh node 18.15.0
# backs the "javascript" language

FROM base AS install-java
RUN /tmp/bake-package.sh java 15.0.2

FROM base AS install-gcc
RUN /tmp/bake-package.sh gcc 10.2.0
# backs both "c" and "c++" (cpp)

FROM base AS install-sqlite3
RUN /tmp/bake-package.sh sqlite3 3.36.0
# backs the "sql" language

FROM base
COPY --from=install-python /piston/packages/python /piston/packages/python
COPY --from=install-node /piston/packages/node /piston/packages/node
COPY --from=install-java /piston/packages/java /piston/packages/java
COPY --from=install-gcc /piston/packages/gcc /piston/packages/gcc
COPY --from=install-sqlite3 /piston/packages/sqlite3 /piston/packages/sqlite3
