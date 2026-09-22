# EDGE-0044 — Device Registry & Multi-Terminal

Adds a durable per-site terminal registry to the Edge.

- `GET /edge/devices` lists registered terminals for authorized administrators.
- `POST /edge/devices/register` registers/heartbeats a terminal using the cached Edge identity.
- `POST /edge/devices/revoke` revokes a terminal.
- `POST /edge/devices/unrevoke` restores a revoked terminal.
- SyncPush automatically registers/updates `deviceId` when the terminal identity is cached.
- Device state is persisted in `device-registry.json`.
- Status is derived from `lastSeenAt` and `EDU_EDGE_DEVICE_OFFLINE_TTL_MS` (default 120s).
- A revoked terminal is rejected from subsequent SyncPush/local registration.
- Cloud remains authoritative; the registry only controls access to this site Edge.
