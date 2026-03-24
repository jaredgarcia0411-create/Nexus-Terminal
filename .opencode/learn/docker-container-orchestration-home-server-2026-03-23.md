# Docker Container Orchestration for Home Server Agent Systems Crash Course
**Researched**: 2026-03-23
**Sources**: Docker docs, Kubernetes docs, Prometheus/Grafana docs, industry patterns
**Context**: Small-scale home server deployment (16GB RAM), agent-based systems

---

## Concept Overview
Docker container orchestration automates deployment, scaling, and management of containerized applications. For home server agent systems, this means reliable, self-healing, monitored services that run autonomously with minimal intervention.

## How It Works
Containers package applications with dependencies, orchestration tools manage their lifecycle across a single host or cluster, monitoring stacks collect metrics/logs, and networking provides isolated communication channels between agents.

## How It Applies Here
For Nexus Terminal and similar agent systems:
- Docker Compose for single-host orchestration (simplest)
- Health checks ensure agents stay alive
- Resource limits prevent OOM kills on 16GB system
- Internal networks isolate agent communication
- Monitoring provides visibility into agent health

## Codebase Evidence
- `services/docker-compose.yml`: Existing 3-agent Docker Compose setup
- `AGENTIC_EXPANSION_V2.md`: References Docker container patterns for agents
- `services/agent.Dockerfile`: Example agent container configuration

## Research Findings

### 1. Docker Compose vs Docker Swarm vs Kubernetes Comparison

**Docker Compose (Recommended for Home Server)**
- **Pros**: Simple YAML configuration, local development, single-host focus, minimal overhead
- **Cons**: No high availability, limited scaling, single point of failure
- **Best for**: 1-10 containers on single machine, personal projects
- **Source**: [Docker Compose Docs](https://docs.docker.com/compose/)

**Docker Swarm**
- **Pros**: Built into Docker Engine, cluster management, service discovery, rolling updates
- **Cons**: Less feature-rich than Kubernetes, declining popularity
- **Best for**: Small clusters (2-5 nodes), simple orchestration needs
- **Source**: [Docker Swarm Docs](https://docs.docker.com/engine/swarm/)

**Kubernetes**
- **Pros**: Industry standard, extensive ecosystem, auto-healing, scaling, RBAC
- **Cons**: High complexity, significant resource overhead (>1GB RAM for control plane)
- **Best for**: Production clusters, multi-node, enterprise workloads
- **Not recommended** for 16GB home server unless learning/testing
- **Source**: [Kubernetes kubeadm Docs](https://kubernetes.io/docs/setup/production-environment/tools/kubeadm/)

**Verdict**: Docker Compose is ideal for home server. Kubernetes overkill, Swarm adds complexity without enough benefit for single host.

### 2. Monitoring/Logging Solutions

**Prometheus + Grafana + Loki Stack (Recommended)**
- **Prometheus**: Time-series metrics collection, alerting, pull-based model
- **Grafana**: Visualization dashboards, alerting UI
- **Loki**: Log aggregation (like Prometheus for logs), indexes logs by labels
- **Resource footprint**: ~500MB-1GB total for all 3 services
- **Setup**: Docker Compose deployment available from Grafana
- **Source**: [Prometheus Getting Started](https://prometheus.io/docs/prometheus/latest/getting_started/), [Grafana Docker](https://grafana.com/docs/grafana/latest/setup-grafana/installation/docker/), [Loki Docker](https://grafana.com/docs/loki/latest/installation/docker/)

**Alternative: cAdvisor + Node Exporter**
- **cAdvisor**: Container metrics (CPU, memory, network, filesystem)
- **Node Exporter**: Host system metrics
- **Lighter**: ~100MB combined
- **Good for**: Basic monitoring without full Grafana/Loki

### 3. Health Checks and Auto-Restart Patterns

**Docker Compose Healthchecks**
```yaml
services:
  agent:
    image: your-agent:latest
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8080/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s
    restart: unless-stopped
```

**Restart Policies (in order of preference)**
1. `unless-stopped`: Restart always unless explicitly stopped (best for agents)
2. `always`: Always restart (even after manual stop)
3. `on-failure`: Restart only on non-zero exit code

**Agent-Specific Health Check Patterns**
- **File-based**: Write timestamp to `/tmp/healthy`, check with `test -f /tmp/healthy && find /tmp/healthy -mmin -2`
- **DB heartbeat**: Query database for recent heartbeat
- **HTTP endpoint**: Expose `/health` endpoint returning 200 OK
- **Process check**: Use `pgrep` or check PID file

**Source**: Docker Compose healthcheck documentation

### 4. Resource Constraints for 16GB RAM System

**Memory Allocation Strategy**
- Reserve 4GB for host OS (Linux + Docker daemon)
- Allocate 10GB across containers
- Leave 2GB buffer for spikes

**Example Container Limits**
```yaml
services:
  agent-1:
    deploy:
      resources:
        limits:
          memory: 512M
        reservations:
          memory: 256M
    mem_limit: 512m
    mem_reservation: 256m
    
  prometheus:
    mem_limit: 512m
    
  grafana:
    mem_limit: 256m
    
  loki:
    mem_limit: 512m
```

**CPU Limits**
```yaml
services:
  agent:
    cpus: '0.5'  # Half a CPU core
    cpu_shares: 512  # Relative weight (default 1024)
```

**Key Principles**
- Set `mem_limit` slightly above typical usage
- Use `mem_reservation` for guaranteed minimum
- Avoid swap (`--memory-swap` equals `--memory` to disable)
- Monitor with `docker stats` and adjust

**Source**: [Docker Resource Constraints Docs](https://docs.docker.com/config/containers/resource_constraints/)

### 5. Networking Patterns for Agent Communication

**User-Defined Bridge Network (Recommended)**
```yaml
networks:
  agent-network:
    driver: bridge
    ipam:
      config:
        - subnet: 172.20.0.0/16

services:
  agent-1:
    networks:
      - agent-network
      
  agent-2:
    networks:
      - agent-network
```

**Service Discovery**
- **Container names as hostnames**: `agent-1` resolves to container IP
- **DNS round-robin**: Multiple containers with same service name
- **No port publishing needed** for internal communication

**External Access**
```yaml
services:
  web-api:
    ports:
      - "3000:3000"  # Host:Container
    networks:
      - agent-network
```

**Network Isolation Patterns**
- **Frontend/Backend separation**: Different networks for different trust levels
- **Database isolation**: DB on private network, app on shared network
- **No external access**: Internal-only networks for sensitive services

**Source**: [Docker Networking Docs](https://docs.docker.com/network/)

### 6. Backup/Recovery Strategies

**Volume Backup**
```bash
# Backup named volume
docker run --rm -v agent-data:/data -v $(pwd):/backup alpine \
  tar czf /backup/agent-data-$(date +%Y%m%d).tar.gz -C /data .

# Restore
docker run --rm -v agent-data:/data -v $(pwd):/backup alpine \
  sh -c "rm -rf /data/* && tar xzf /backup/agent-data-backup.tar.gz -C /data"
```

**Compose File Backup**
```bash
# Version control docker-compose.yml
git add docker-compose.yml
git commit -m "Update compose configuration"

# Export running configuration
docker-compose config > docker-compose-backup-$(date +%Y%m%d).yml
```

**Image Backup**
```bash
# Save images to tar
docker save -o agent-images-$(date +%Y%m%d).tar \
  your-agent:latest \
  prom/prometheus:latest \
  grafana/grafana:latest

# Load images
docker load -i agent-images-backup.tar
```

**Recovery Procedure**
1. Restore volumes from backup
2. Load Docker images
3. Start with `docker-compose up -d`
4. Verify with `docker-compose ps` and health checks

**Automated Backup with Cron**
```bash
# /etc/cron.daily/docker-backup
#!/bin/bash
BACKUP_DIR=/backup/docker/$(date +%Y-%m-%d)
mkdir -p $BACKUP_DIR
cd /path/to/docker-compose
docker-compose config > $BACKUP_DIR/docker-compose.yml
docker-compose ps > $BACKUP_DIR/status.txt
# Add volume backup commands...
```

## Best Practices

1. **Version pin images**: Use `image: your-agent:v1.2.3` not `latest`
2. **Use named volumes**: `volumes: - agent-data:/data` not host mounts
3. **Environment variables**: Store config in `.env` file, not compose
4. **Log rotation**: Configure `json-file` driver with size limits
5. **Security**: Run as non-root user in containers, use read-only rootfs
6. **Updates**: Test in staging, use blue-green deployment patterns
7. **Documentation**: Keep `docker-compose.yml` well-commented

## Common Pitfalls

**Pitfall**: OOM kills due to no memory limits
**Solution**: Set `mem_limit` on all containers, monitor with Prometheus

**Pitfall**: Orphaned containers after crashes
**Solution**: Use `restart: unless-stopped` and health checks

**Pitfall**: Network conflicts with host
**Solution**: Use custom subnets (`172.20.0.0/16`) not default Docker ranges

**Pitfall**: Lost data on container recreation
**Solution**: Use named volumes, regular backups

**Pitfall**: Security issues from exposed ports
**Solution**: Only publish necessary ports, use internal networks

## Recommended Default Approach for Home Server

**For Nexus Terminal Agent System**:
1. **Orchestration**: Docker Compose (already implemented)
2. **Monitoring**: Prometheus + Grafana + Node Exporter (lightweight)
3. **Health checks**: File-based or HTTP with `restart: unless-stopped`
4. **Resources**: 512MB per agent, 1GB for monitoring stack
5. **Networking**: Single user-defined bridge network
6. **Backup**: Daily cron job backing up named volumes

**Sample docker-compose.yml Structure**:
```yaml
version: '3.8'
services:
  agent-1:
    image: your/agent:1.0
    container_name: agent-1
    restart: unless-stopped
    mem_limit: 512m
    cpus: '0.5'
    healthcheck:
      test: ["CMD", "test", "-f", "/tmp/healthy"]
      interval: 30s
      timeout: 10s
      retries: 3
    networks:
      - agent-net
    volumes:
      - agent-1-data:/data
  
  prometheus:
    image: prom/prometheus:latest
    restart: unless-stopped
    mem_limit: 512m
    ports:
      - "9090:9090"
    networks:
      - agent-net
    volumes:
      - prometheus-data:/prometheus
  
networks:
  agent-net:
    driver: bridge
    ipam:
      config:
        - subnet: 172.20.0.0/16

volumes:
  agent-1-data:
  prometheus-data:
```

## Action Checklist

- [ ] Audit existing `services/docker-compose.yml` against best practices
- [ ] Add health checks to all agent services
- [ ] Set memory limits based on 16GB system capacity
- [ ] Create user-defined bridge network if not exists
- [ ] Implement monitoring stack (Prometheus/Grafana)
- [ ] Set up backup cron job for volumes
- [ ] Document recovery procedure
- [ ] Test restart scenarios (docker daemon restart, host reboot)

## Known Unknowns

- Exact memory requirements for your specific agent workloads
- Network throughput needs between agents
- Backup frequency vs storage space tradeoffs
- Whether to use Docker Swarm for future expansion

## Related Topics

- Docker security best practices
- CI/CD for container deployment
- Stateful vs stateless container patterns
- Service mesh (Istio, Linkerd) for advanced networking

## Follow-up Questions

*To continue learning, use: `/research more about [Topic]` or ask follow-up questions*

---
*This crash course provides practical guidance for deploying Docker-based agent systems on a home server with 16GB RAM. Focus on simplicity with Docker Compose, add monitoring incrementally, and prioritize reliability through health checks and resource limits.*