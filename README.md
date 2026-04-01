# Coolify Volume Migrator

A CLI tool built with Bun + TypeScript that migrates persistent data of a service from one Coolify server to another.

## What it does

- Guides the user through the entire migration process via an interactive wizard
- Automatically discovers servers, services, containers, and their persistent mounts
- Matches source and target volumes/bind mounts
- Transfers data using streaming (tar over SSH for volumes, rsync for bind mounts)
- Stops and starts containers as needed
- Verifies the migration result
- Provides clear, human-readable status and error messages throughout

## CLI Commands

| Command         | Purpose                                              |
|-----------------|------------------------------------------------------|
| `migrate`       | Run a full migration (interactive, flags, or both)   |
| `inspect`       | Show containers, mounts, risks, and matchings        |
| `list-services` | List discoverable services on a host                 |
| `verify`        | Check target health after a migration                |
| `doctor`        | Diagnose SSH, Docker, rsync availability and permissions |

## Usage

Interactive:
```bash
bun run src/cli.ts migrate
```

With flags:
```bash
bun run src/cli.ts migrate \
  --source root@server-a \
  --target root@server-b \
  --source-service n8n \
  --target-service n8n
```

Fully non-interactive:
```bash
bun run src/cli.ts migrate \
  --source root@server-a \
  --target root@server-b \
  --source-service n8n \
  --target-service n8n \
  --stop-source --clear-target --start-target --yes
```

## Safety

- No destructive action without explicit confirmation (or `--yes`)
- Warns before overwriting non-empty targets
- Detects database volumes and warns about consistency risks
- Supports `--dry-run` to preview the migration plan without executing it

## Requirements

- Bun runtime
- SSH access to source and target hosts
- Docker and rsync installed on both hosts
