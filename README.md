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
| `wizard`        | Interactive step-by-step guide to set up and run a migration |
| `migrate`       | Run a full migration (interactive, flags, or both)   |
| `inspect`       | Show containers, mounts, risks, and matchings        |
| `list-services` | List discoverable services on a host                 |
| `verify`        | Check target health after a migration                |
| `doctor`        | Diagnose SSH, Docker, rsync availability and permissions |

## Installation

Download the latest release:

```bash
sudo curl -sL -o /usr/local/bin/volume-migrator https://github.com/poesterlin/volume-migrator/releases/latest/download/volume-migrator-linux-x64
sudo chmod +x /usr/local/bin/volume-migrator
```

## Usage

Guided wizard (recommended for first-time use):
```bash
volume-migrator wizard
```

With flags:
```bash
volume-migrator migrate \
  --source root@server-a \
  --target root@server-b \
  --source-service n8n \
  --target-service n8n
```

Fully non-interactive:
```bash
volume-migrator migrate \
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

- Linux x64
- SSH access to source and target hosts
- Docker and rsync installed on both hosts

## Development

Run from source (requires [Bun](https://bun.sh)):

```bash
bun install
bun run src/cli.ts migrate
```

Build a standalone binary locally:

```bash
bun run build:bin
./volume-migrator doctor
```
