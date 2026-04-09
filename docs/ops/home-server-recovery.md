# Home Server Recovery

Use this runbook when the home server is rebooted, loses power, or recovers from an ISP outage. It assumes the agent stack runs from `services/docker-compose.yml` on the WSL2 host.

## Scope

- WSL2 recovery after a Windows reboot
- Docker daemon restart on the host
- Bringing the agent stack back up with `docker compose`
- Verifying the healthcheck state after recovery

## Expected services

The compose file defines four services:

- `orchestrator`
- `small-cap-trader`
- `swing-trader`
- `discord-bot`

The three agent services must reach `healthy`. The Discord bot must be `Up` and running.

## Recovery flow

1. Open a terminal on the Windows host.
2. If WSL is stuck or the distro did not come back cleanly, reset WSL first:
   ```sh
   wsl --shutdown
   ```
3. Start WSL again and open the Linux shell for the Nexus terminal environment.
4. Start Docker if the daemon is not already running:
   ```sh
   sudo systemctl start docker
   ```
5. Confirm Docker responds:
   ```sh
   docker info
   ```
6. Bring the stack up from the repo root:
   ```sh
   docker compose -f services/docker-compose.yml up -d
   ```
7. Wait roughly 60 seconds for the agent healthchecks to settle.
8. Check service status:
   ```sh
   docker compose -f services/docker-compose.yml ps
   ```
9. Verify the expected state:
   - `orchestrator`, `small-cap-trader`, and `swing-trader` should show `healthy`
   - `discord-bot` should show `Up`

## If the stack does not come up cleanly

If a service is not healthy, inspect its logs:

```sh
docker compose -f services/docker-compose.yml logs --tail=100 <service-name>
```

Useful signals:

- `orchestrator`, `small-cap-trader`, and `swing-trader` should not be crash-looping.
- `discord-bot` should stay connected to Discord and log a ready event.
- A healthcheck failure usually means the worker did not refresh its heartbeat inside the expected window.

If Docker itself is the problem:

1. Confirm the daemon is active:
   ```sh
   systemctl status docker
   ```
2. Start it again if needed:
   ```sh
   sudo systemctl start docker
   ```
3. Re-run:
   ```sh
   docker compose -f services/docker-compose.yml up -d
   ```
4. Re-check `docker compose -f services/docker-compose.yml ps`.

## Post-outage sequence

After an ISP outage or full power loss, use this order:

1. Boot Windows.
2. Let WSL initialize, or run `wsl --shutdown` followed by a fresh start if the distro resumes in a bad state.
3. Start Docker with `sudo systemctl start docker` if it is not already active.
4. Run `docker compose -f services/docker-compose.yml up -d`.
5. Wait for the healthcheck window to pass.
6. Run `docker compose -f services/docker-compose.yml ps`.
7. Confirm the three agent services are `healthy` and `discord-bot` is `Up`.
8. If one service is unhealthy, inspect logs before retrying the full stack.

## Fast recovery summary

If you need the shortest safe path:

1. `wsl --shutdown` if WSL is wedged.
2. `sudo systemctl start docker`.
3. `docker compose -f services/docker-compose.yml up -d`.
4. Wait for the healthcheck window.
5. `docker compose -f services/docker-compose.yml ps`.

## Verification checklist

- `docker compose -f services/docker-compose.yml up -d` exits 0
- `docker compose -f services/docker-compose.yml ps` shows the expected health state
- The three agent services are `healthy`
- `discord-bot` is `Up` and running

## Notes

- Do not change the compose file while doing recovery.
- Do not assume Docker will auto-start after a Windows reboot.
- If the heartbeat timing changes in the future, this runbook should be updated to match the new healthcheck window.
