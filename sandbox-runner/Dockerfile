FROM alpine:3.20

RUN apk add --no-cache ca-certificates coreutils curl jq \
    && addgroup -S sandbox \
    && adduser -S -D -H -u 10001 -G sandbox sandbox \
    && mkdir /workspace \
    && chown sandbox:sandbox /workspace

COPY --chmod=0555 entrypoint.sh /usr/local/bin/sandbox-entrypoint

USER sandbox
WORKDIR /workspace
ENTRYPOINT ["/usr/local/bin/sandbox-entrypoint"]
