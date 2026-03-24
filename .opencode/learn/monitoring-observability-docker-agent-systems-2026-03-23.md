# Monitoring and Observability Tools for Docker-based Agent Systems Crash Course
**Researched**: 2026-03-23
**Sources**: Prometheus/Grafana/Loki docs, Datadog docs, New Relic docs, Docker monitoring patterns
**Context**: Docker-based agent systems on home server (16GB RAM), cost-effective monitoring

---

## Concept Overview
Observability for Docker-based agent systems involves collecting metrics, logs, and traces to understand system health, agent performance, and detect failures. Monitoring ensures agents are functioning correctly, resources are properly allocated, and issues are alerted before impacting operations.

## How It Works
Prometheus collects time-series metrics via pull model, Grafana visualizes them, Loki aggregates logs, and Alertmanager handles notifications. For agent systems, specialized metrics track job throughput, LLM costs, error rates, and agent-specific health indicators.

## How It Applies Here
For Nexus Terminal's agent systems (including Schwab relay service):
- Prometheus + Grafana + Loki stack for cost-effective monitoring
- Agent-specific metrics: WebSocket connections, DB writes, LLM token usage
- Docker Compose health checks with auto-restart
- Alerting on agent failures, high error rates, resource exhaustion

## Codebase Evidence
- `services/schwab-relay/src/index.ts`: Error logging patterns
- `drizzle/meta/*.json`: `agent_memory` table structure for agent state
- `.opencode/learn/docker-container-orchestration-home-server-2026-03-23.md`: Existing monitoring recommendations

## Research Findings

### 1. Prometheus/Grafana/Loki vs Commercial Alternatives (Datadog, New Relic)

#### Prometheus/Grafana/Loki Stack (Recommended for Home Server)
**Pros**:
- **Cost**: Free/open source, no per-agent fees
- **Control**: Full control over data retention, storage, alerting
- **Integration**: Native Docker/Prometheus integration
- **Resource footprint**: ~500MB-1GB total for all 3 services
- **Flexibility**: Custom dashboards, alert rules, scraping configs

**Cons**:
- **Complexity**: Requires configuration and maintenance
- **No SaaS benefits**: No managed scaling, uptime guarantees
- **Learning curve**: Need to understand PromQL, LogQL

**Best for**: Small-scale deployments, home servers, budget-conscious projects
**Source**: [Prometheus Docs](https://prometheus.io/docs/introduction/overview/), [Grafana Docker](https://grafana.com/docs/grafana/latest/setup-grafana/installation/docker/)

#### Datadog
**Pros**:
- **Integrated platform**: Metrics, logs, APM, traces in one UI
- **Ease of use**: Auto-discovery, pre-built dashboards
- **SaaS benefits**: No infrastructure management
- **Advanced features**: AI anomaly detection, Watchdog
- **Agent-based**: Datadog Agent handles collection

**Cons**:
- **Cost**: ~$15-30/month per host, additional for features
- **Vendor lock-in**: Data stored externally
- **Limited control**: Cannot modify core collection logic
- **Overkill for small**: Many features unused in small setups

**Pricing**: Infrastructure monitoring starts at $15/host/month, APM $31/host/month
**Best for**: Enterprise teams, multi-cloud, when budget allows
**Source**: [Datadog Docs](https://docs.datadoghq.com/)

#### New Relic
**Pros**:
- **Comprehensive**: APM, infrastructure, browser monitoring
- **Developer-friendly**: CodeStream IDE integration
- **Generous free tier**: 100GB/month data ingest free
- **NRQL**: Powerful query language for data analysis

**Cons**:
- **Cost**: Similar to Datadog at scale
- **Complex pricing**: Multiple SKUs, usage-based billing
- **Less Docker-native**: More focused on traditional app monitoring

**Pricing**: Free tier available, paid tiers ~$0.30/GB after free tier
**Best for**: Application performance focus, when using free tier
**Source**: [New Relic Docs](https://docs.newrelic.com/)

**Verdict**: For home server agent systems, Prometheus/Grafana/Loki is optimal. Commercial solutions cost $300-600/year for small setup, open-source stack costs $0.

### 2. Agent-Specific Metrics to Track

#### Core Agent Metrics
```prometheus
# Job throughput
agent_jobs_processed_total{agent="schwab-relay"}
agent_job_duration_seconds{agent="schwab-relay",status="success"}

# Error rates
agent_errors_total{agent="schwab-relay",error_type="websocket"}
agent_error_rate_per_minute{agent="schwab-relay"}

# Resource usage
agent_memory_bytes{agent="schwab-relay"}
agent_cpu_seconds_total{agent="schwab-relay"}

# Health indicators
agent_health_check_status{agent="schwab-relay"}  # 1=healthy, 0=unhealthy
agent_uptime_seconds{agent="schwab-relay"}
```

#### LLM/API Cost Metrics
```prometheus
# LLM usage tracking
llm_tokens_used_total{agent="jarvis",model="gpt-4"}
llm_cost_usd_total{agent="jarvis",model="gpt-4"}
llm_requests_total{agent="jarvis",status="success"}

# API rate limits
api_requests_remaining{service="askedar"}
api_rate_limit_reset_seconds{service="askedar"}
```

#### Docker Container Metrics
```prometheus
# Container resource usage
container_memory_usage_bytes{name="schwab-relay"}
container_cpu_usage_seconds_total{name="schwab-relay"}

# Container health
container_health_status{name="schwab-relay"}  # 0=unhealthy, 1=starting, 2=healthy
container_restarts_total{name="schwab-relay"}

# Network I/O
container_network_receive_bytes_total{name="schwab-relay"}
container_network_transmit_bytes_total{name="schwab-relay"}
```

#### Schwab Relay Specific Metrics
```prometheus
# WebSocket connections
websocket_connections_active{service="schwab-relay"}
websocket_messages_received_total{service="schwab-relay"}
websocket_reconnects_total{service="schwab-relay"}

# Database operations
db_writes_total{table="realtime_quotes"}
db_write_duration_seconds{table="realtime_quotes"}

# Token synchronization
token_sync_success_total{agent="schwab-relay"}
token_sync_duration_seconds{agent="schwab-relay"}
```

### 3. Logging Patterns for Multi-Agent Systems

#### Structured Logging with Loki
```javascript
// Agent logging pattern
const logEntry = {
  timestamp: new Date().toISOString(),
  level: 'INFO',
  agent: 'schwab-relay',
  component: 'websocket',
  message: 'WebSocket connection established',
  connection_id: 'ws-123',
  duration_ms: 150,
  labels: {
    environment: 'production',
    version: '1.2.3'
  }
};

// Send to Loki via Promtail
fetch('http://loki:3100/loki/api/v1/push', {
  method: 'POST',
  headers: {'Content-Type': 'application/json'},
  body: JSON.stringify({
    streams: [{
      stream: {agent: 'schwab-relay', component: 'websocket'},
      values: [[Date.now().toString(), JSON.stringify(logEntry)]]
    }]
  })
});
```

#### Log Aggregation Architecture
```
Agents → Promtail (Docker log driver) → Loki → Grafana
                   ↓
           Structured metadata
           (agent, component, level)
```

#### Docker Compose Log Configuration
```yaml
services:
  schwab-relay:
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"
        tag: "{{.Name}}/{{.ImageName}}"

  promtail:
    image: grafana/promtail:latest
    volumes:
      - /var/log:/var/log
      - /var/lib/docker/containers:/var/lib/docker/containers:ro
    command: -config.file=/etc/promtail/config.yml
```

#### Log Levels by Agent Type
- **Error/Alert logs**: Immediate notification required
- **Info logs**: Normal operation, useful for debugging
- **Debug logs**: Verbose, disabled in production
- **Audit logs**: Security-sensitive operations

#### Multi-Agent Log Correlation
```logql
# Find all logs for failed agent jobs
{agent=~"agent-.*"} |= "error" | logfmt | duration > 5s

# Correlate errors across agents
{agent="schwab-relay"} |= "WebSocket error"
{agent="jarvis"} |= "API call failed" |~ "schwab"

# Track user journey across agents
{user_id="123"} | json | agent!=""
```

### 4. Alerting Strategies for Agent Failures

#### Prometheus Alert Rules
```yaml
groups:
- name: agent-alerts
  rules:
  - alert: AgentDown
    expr: up{job="agent"} == 0
    for: 1m
    labels:
      severity: critical
    annotations:
      summary: "Agent {{ $labels.instance }} is down"
      description: "Agent {{ $labels.instance }} has been down for more than 1 minute"
  
  - alert: HighErrorRate
    expr: rate(agent_errors_total[5m]) > 0.1
    for: 2m
    labels:
      severity: warning
    annotations:
      summary: "High error rate for {{ $labels.agent }}"
      description: "Error rate is {{ $value }} errors/sec"
  
  - alert: HighMemoryUsage
    expr: container_memory_usage_bytes{name=~"agent-.*"} / container_spec_memory_limit_bytes{name=~"agent-.*"} > 0.9
    for: 5m
    labels:
      severity: warning
    annotations:
      summary: "High memory usage for {{ $labels.name }}"
      description: "Memory usage at {{ $value | humanizePercentage }} of limit"
  
  - alert: LLMCostExceeded
    expr: llm_cost_usd_total{agent="jarvis"} > 50
    labels:
      severity: warning
    annotations:
      summary: "LLM cost exceeded $50 for Jarvis agent"
      description: "Current cost: ${{ $value }}"
```

#### Alert Escalation Strategy
1. **Immediate (PagerDuty/SMS)**: Agent completely down, data loss imminent
2. **Hourly (Email/Slack)**: Performance degradation, high error rates
3. **Daily (Email digest)**: Resource trends, cost anomalies
4. **Weekly (Report)**: Usage patterns, optimization opportunities

#### Docker Health Check Integration
```yaml
services:
  agent:
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8080/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s
    restart: unless-stopped
```

#### Alert Routing by Agent Type
- **Critical agents** (Schwab relay): Immediate notification, auto-restart
- **Background agents** (Data processors): Hourly notification, manual intervention
- **Batch agents** (Report generators): Daily notification, retry logic

### 5. Cost-Effective Monitoring for Small-Scale Home Server

#### Minimal Monitoring Stack (Under 500MB)
```yaml
# docker-compose.monitoring.yml
version: '3.8'
services:
  prometheus:
    image: prom/prometheus:latest
    ports: ["9090:9090"]
    volumes: ["./prometheus.yml:/etc/prometheus/prometheus.yml"]
    command: "--config.file=/etc/prometheus/prometheus.yml --storage.tsdb.retention.time=15d"
    mem_limit: 256m
  
  grafana:
    image: grafana/grafana:latest
    ports: ["3000:3000"]
    environment:
      - GF_SECURITY_ADMIN_PASSWORD=admin
      - GF_INSTALL_PLUGINS=grafana-piechart-panel
    volumes: ["./grafana-data:/var/lib/grafana"]
    mem_limit: 128m
  
  node-exporter:
    image: prom/node-exporter:latest
    ports: ["9100:9100"]
    mem_limit: 64m
  
  cadvisor:
    image: gcr.io/cadvisor/cadvisor:latest
    ports: ["8080:8080"]
    volumes:
      - /:/rootfs:ro
      - /var/run:/var/run:ro
      - /sys:/sys:ro
      - /var/lib/docker/:/var/lib/docker:ro
    mem_limit: 128m
```

#### Prometheus Configuration for Agents
```yaml
# prometheus.yml
global:
  scrape_interval: 15s
  evaluation_interval: 15s

scrape_configs:
  - job_name: 'docker-agents'
    static_configs:
      - targets: ['schwab-relay:8080', 'agent-1:8080', 'agent-2:8080']
  
  - job_name: 'docker-containers'
    static_configs:
      - targets: ['cadvisor:8080']
  
  - job_name: 'node'
    static_configs:
      - targets: ['node-exporter:9100']
```

#### Cost Breakdown for 16GB Home Server
| Solution | First Year Cost | Ongoing Cost | Setup Time | Maintenance |
|----------|----------------|--------------|------------|-------------|
| **Prometheus/Grafana/Loki** | $0 | $0 | 4-8 hours | 1-2 hours/month |
| **Datadog** | $180-360 | $180-360/year | 1-2 hours | Minimal |
| **New Relic** | $0-100 | $0-200/year | 1-2 hours | Minimal |
| **Grafana Cloud Free** | $0 | $0 | 2-4 hours | Minimal |

#### Resource Allocation (16GB RAM System)
- **Host OS**: 2GB
- **Docker daemon**: 500MB
- **Monitoring stack**: 500MB-1GB
- **Agent containers**: 2-4GB (depending on workload)
- **Buffer**: 2-3GB
- **Total**: ~16GB

#### Optimized Agent Metrics Collection
```yaml
# Reduce metric cardinality
metric_relabel_configs:
  - source_labels: [__name__]
    regex: '.*_(total|count|sum)'
    action: keep
  
# Limit scrape frequency for non-critical agents
scrape_configs:
  - job_name: 'background-agents'
    scrape_interval: 60s
    static_configs:
      - targets: ['batch-agent:8080']
  
# Drop high-cardinality labels
  - job_name: 'high-volume'
    metric_relabel_configs:
      - regex: '(instance|pod)'
        action: labeldrop
```

#### Backup and Retention Strategy
```bash
# Daily Prometheus snapshot
docker exec prometheus wget -q -O - http://localhost:9090/api/v1/admin/tsdb/snapshot

# Weekly Loki log export
docker run --rm -v loki-data:/data -v $(pwd):/backup alpine \
  tar czf /backup/loki-$(date +%Y%m%d).tar.gz -C /data .

# 15-day retention (adjust based on disk space)
# prometheus.yml
storage:
  tsdb:
    retention: 15d
```

## Best Practices

1. **Start minimal**: Begin with Prometheus + Node Exporter, add Grafana, then Loki
2. **Use labels wisely**: High-cardinality labels (user_id, session_id) blow up storage
3. **Set retention policies**: 15-30 days for metrics, 7-14 days for logs on home server
4. **Implement health checks**: Docker healthchecks with Prometheus alerts
5. **Test alerting**: Regularly test alert pathways work
6. **Document dashboards**: Create runbooks for each critical alert
7. **Monitor costs**: Track LLM/API usage to avoid surprise bills
8. **Automate recovery**: Auto-restart failed agents with exponential backoff

## Common Pitfalls

**Pitfall**: Metric cardinality explosion from unlabeled high-volume data
**Solution**: Use aggregation, drop non-essential labels, increase scrape intervals

**Pitfall**: Alert fatigue from noisy alerts
**Solution**: Tune thresholds, add hysteresis, group related alerts

**Pitfall**: Storage exhaustion from unlimited retention
**Solution**: Set retention policies, compress old data, monitor disk usage

**Pitfall**: Missing critical alerts due to misconfiguration
**Solution**: Test alert delivery regularly, use multiple notification channels

**Pitfall**: Performance impact from monitoring overhead
**Solution**: Limit scrape frequency, use sampling for high-volume metrics

## Recommended Default Approach for Home Server Agent Systems

**For Nexus Terminal**:
1. **Core stack**: Prometheus + Grafana + Node Exporter (start here)
2. **Logging**: Add Loki + Promtail once basic monitoring stable
3. **Alerting**: Configure Alertmanager with Slack/email notifications
4. **Agent instrumentation**: Add Prometheus client libraries to agents
5. **Dashboard**: Create agent-specific dashboards showing:
   - Container health/resource usage
   - Agent-specific metrics (WebSocket connections, DB writes)
   - Error rates and trends
   - Cost tracking for paid APIs

**Implementation Priority**:
1. ✅ Docker health checks on all agents
2. 🔄 Prometheus scraping agent metrics
3. 🔄 Grafana dashboards for visualization
4. 🔄 Alertmanager for critical alerts
5. 🔄 Loki for centralized logging
6. 🔄 Cost tracking dashboards

## Action Checklist

- [ ] Install Prometheus + Grafana via Docker Compose
- [ ] Configure Prometheus to scrape agent metrics endpoints
- [ ] Create basic dashboards for container health
- [ ] Set up Alertmanager with email/Slack notifications
- [ ] Add Prometheus client to Schwab relay service
- [ ] Implement health check endpoints on all agents
- [ ] Configure Loki for agent log aggregation
- [ ] Create agent-specific alert rules
- [ ] Set up disk usage monitoring and alerts
- [ ] Document monitoring setup and runbooks

## Known Unknowns

- Exact Prometheus storage requirements for your agent volume
- Optimal alert thresholds for your specific workloads
- Whether to use Grafana Cloud free tier vs self-hosted
- Log retention needs based on troubleshooting frequency
- Alert notification preferences (Slack vs Email vs SMS)

## Related Topics

- Distributed tracing for multi-agent request flows
- Business metrics vs operational metrics
- SLO/SLI definition and tracking
- Cost allocation by user/team for shared agent systems
- Security monitoring for agent authentication/authorization

## Follow-up Questions

*To continue learning, use: `/research more about [Topic]` or ask follow-up questions*

---

*This crash course provides practical guidance for implementing cost-effective monitoring for Docker-based agent systems on a home server. Start with the minimal Prometheus+Grafana stack, incrementally add features based on needs, and prioritize reliability through automated health checks and alerting.*