# NVIDIA NemoClaw Crash Course

**Researched**: 2026-03-17  
**Sources**: GitHub, NVIDIA docs, codebase analysis  
**Context**: Your trading terminal's agentic framework

---

## Concept Overview

NVIDIA NemoClaw is an **open-source TypeScript/Python plugin** that provides secure, sandboxed execution for OpenClaw AI agents. It's part of the broader NVIDIA NeMo ecosystem (agent toolkit, not the speech framework) and routes inference through NVIDIA's cloud API (`nvidia/nemotron-3-super-120b-a12b`).

Think of it as: "Docker Compose for AI agents with built-in security policies" — it wraps agents in isolated sandboxes with network egress controls, filesystem restrictions, and privileged syscall blocking.

---

## What It Actually Is

Despite the name sounding like a tool for LLMs, **NemoClaw is NOT a model or inference engine**. It's infrastructure:

- **Runtime layer**: Installs NVIDIA OpenShell (secure container runtime)
- **Policy enforcer**: Declarative network/filesystem/inference policies
- **CLI wrapper**: `nemoclaw onboard` creates sandboxed agent environments
- **Blueprint orchestrator**: Python artifacts that define sandbox configuration

Key files in the repo:
- `nemoclaw/` - TypeScript CLI plugin
- `nemoclaw-blueprint/` - Python blueprint for sandbox creation
- `install.sh` - Automated setup script

---

## How It Works

```
┌─────────────────────────────────────────────────────────────┐
│  Host Machine (Ubuntu 22.04+)                               │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  NemoClaw CLI (TypeScript)                           │   │
│  │  - onboard: creates sandbox                          │   │
│  │  - connect: enters container                         │   │
│  │  - status: health checks                             │   │
│  └──────────────────┬───────────────────────────────────┘   │
│                     │                                        │
│  ┌──────────────────▼───────────────────────────────────┐   │
│  │  OpenShell Runtime (secure container)               │   │
│  │  ┌──────────────────────────────────────────────┐  │   │
│  │  │  OpenClaw Agent                              │  │   │
│  │  │  - Filesystem: locked to /sandbox, /tmp      │  │   │
│  │  │  - Network: egress controlled by policy      │  │   │
│  │  │  - Inference: intercepted → NVIDIA cloud       │  │   │
│  │  └──────────────────────────────────────────────┘  │   │
│  └───────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
                    ┌──────────────────┐
                    │  NVIDIA Cloud    │
                    │  Nemotron models │
                    └──────────────────┘
```

**Protection layers**:
1. **Network**: Blocks unauthorized outbound connections (hot-reloadable)
2. **Filesystem**: Prevents reads/writes outside `/sandbox` and `/tmp` (locked at creation)
3. **Process**: Blocks privilege escalation and dangerous syscalls (locked at creation)
4. **Inference**: Reroutes API calls to controlled backends (hot-reloadable)

---

## In Your Codebase Context

### Current State vs NemoClaw

**Your current setup** (from codebase analysis):
- **LLM Provider**: Groq API (`llama-3.3-70b-versatile`)
- **Planned**: Switch to NVIDIA API (`deepseek-v3.2`)
- **Architecture**: Provider-agnostic OpenAI-compatible client in `lib/jarvis/client.ts`
- **Future**: Multi-agent Docker Compose system (`AGENTIC_EXPANSION_V2.md`)

**How NemoClaw fits**:

| Your Component | NemoClaw Equivalent | Fit |
|----------------|---------------------|-----|
| Docker Compose agents | OpenShell sandboxes | Direct replacement with security |
| `lib/agents/llm-client.ts` | OpenShell gateway | NemoClaw routes inference |
| Agent memory (Postgres) | OpenClaw memory | Could use instead |
| Blueprint runner (your custom) | OpenClaw blueprints | Similar concept, different impl |

### Integration Opportunities

**1. Replace your Docker Compose agents** (AGENTIC_EXPANSION_V2.md Phase 5)

Your planned agents:
```yaml
# Your docker-compose.yml
services:
  orchestrator:
    memory: 512M
  small-cap-trader:
    memory: 512M
  long-term-investor:
    memory: 512M
```

NemoClaw equivalent:
```bash
$ nemoclaw onboard
# Creates 3 sandboxes with:
# - Network policies restricting egress to only Neon Postgres
# - Filesystem locked to agent working directories
# - Inference routed through OpenShell gateway
```

**2. Enhanced security for your agent jobs**

Your current job queue (`agent_jobs` table) has no sandboxing. NemoClaw would:
- Run each agent in isolated Landlock + seccomp + netns
- Block agents from accessing unauthorized APIs
- Log every network request for audit

**3. Replace llama.cpp for local inference** (Section 8.3 of your spec)

Your plan:
```bash
AGENT_API_BASE_URL=http://host.docker.internal:8080/v1/chat/completions
# llama.cpp local model
```

With NemoClaw:
```bash
# Uses NVIDIA cloud inference, but sandboxes the agent
# No local GPU needed, inference happens in NVIDIA cloud
```

---

## Code Examples

### Creating a sandboxed agent (NemoClaw)

```bash
# One-command setup
curl -fsSL https://nvidia.com/nemoclaw.sh | bash

# Interactive wizard
$ nemoclaw onboard
✓ Sandbox name: small-cap-trader
✓ Model: nvidia/nemotron-3-super-120b-a12b
✓ API key: [redacted]
✓ Policy: strict-network

# Connect to sandbox
$ nemoclaw small-cap-trader connect
sandbox@small-cap-trader:~$ openclaw tui
```

### Declarative network policy

```yaml
# ~/.nemoclaw/policies/small-cap-trader.yaml
network:
  egress:
    - host: "*.neon.tech"  # Your Postgres
      port: 443
    - host: "api.polygon.io"  # Massive API
      port: 443
    - host: "eapi.askedgar.io"  # AskEdgar
      port: 443
    # Block everything else
```

### Blueprint structure (similar to your blueprints)

```python
# nemoclaw-blueprint/blueprint.py
class SmallCapTraderBlueprint:
    """NemoClaw blueprint vs your AGENTIC_EXPANSION_V2.md blueprint"""
    
    steps = [
        # Step 1: Fetch market data
        {
            "name": "fetch-snapshot",
            "type": "code",  # Same as your 'code' steps
            "run": "fetch_massive_snapshot"
        },
        # Step 2: LLM analysis  
        {
            "name": "analyze-dilution",
            "type": "llm",  # Same as your 'llm' steps
            "model": "nvidia/nemotron-3-super-120b-a12b",
            "prompt": "analyze_dilution"
        }
    ]
```

---

## Best Practices

1. **Treat it as infrastructure, not an LLM**  
   NemoClaw doesn't replace your `deepseek-v3.2` calls — it secures the runtime where those calls happen. Keep your provider-agnostic LLM client pattern.

2. **Start with permissive policies, tighten gradually**  
   The default strict policy might break your Massive/AskEdgar integrations. Use `nemoclaw <name> logs` to see blocked requests, then whitelist specific hosts.

3. **Use it for agent isolation, not model switching**  
   Your `AGENTIC_EXPANSION_V2.md` already supports local models via llama.cpp. NemoClaw is better suited for cloud inference isolation than local model hosting.

4. **Monitor the TUI for blocked requests**  
   When agents try to reach unlisted hosts, OpenSurface blocks them and surfaces requests in `opensurface term` for approval. Check this regularly during development.

5. **Consider it for compliance, not cost savings**  
   NemoClaw adds overhead (sandbox creation, policy enforcement). Use it when you need audit trails, not when optimizing for speed/cost.

---

## Common Pitfalls

**Pitfall**: Thinking NemoClaw replaces your multi-agent architecture  
**Reality**: It's a security layer. Your orchestrator → agent → blueprint → job queue design remains valid. NemoClaw just runs each agent in a locked-down container.

**Pitfall**: Trying to run it on macOS/Windows  
**Reality**: Ubuntu 22.04+ only. Your Vercel deployment won't work with this. It's designed for the "home server" scenario in your `AGENTIC_EXPANSION_V2.md`.

**Pitfall**: Expecting local model inference  
**Reality**: NemoClaw routes to NVIDIA cloud. For local inference (your Section 8.3), stick with llama.cpp or similar.

**Pitfall**: Confusing it with NeMo Guardrails  
**Reality**: Different projects. Guardrails is for LLM output validation (your `lib/jarvis/circuit-breaker.ts` pattern). NemoClaw is runtime sandboxing.

---

## Related Topics

- **NVIDIA NeMo Guardrails** — Dialog management and output validation (closer to what you need for agent reasoning)
- **Your `AGENTIC_EXPANSION_V2.md`** — Your custom multi-agent architecture
- **OpenClaw** — The agent framework NemoClaw wraps (check openclaw.ai)
- **llama.cpp** — Better fit for your local model requirements (Section 8.3)

---

## Follow-up Questions

### Q: Should I use NemoClaw for my trading agents?

**Asked**: 2026-03-17  
**Answer**: Probably not for v1. Your `AGENTIC_EXPANSION_V2.md` design is simpler and sufficient:

| Requirement | Your Design | NemoClaw |
|-------------|-------------|----------|
| Agent isolation | Docker Compose containers | OpenShell sandboxes (more secure) |
| Network policies | None (full internet) | Declarative egress rules |
| Inference routing | Direct to NVIDIA API | Through OpenShell gateway |
| Complexity | Medium | High (new runtime to learn) |
| Ubuntu requirement | Optional | Mandatory |

**Verdict**: Implement your Docker-based agents first. Add NemoClaw later if you need:
- Audit logs of every network request
- Block agents from accessing unauthorized APIs
- Compliance requirements requiring sandboxed execution

### Q: What's the difference between NemoClaw and my blueprint pattern?

**Asked**: 2026-03-17  
**Answer**: Different layers:

- **Your blueprints** (Section 6.4): Define WHAT agents do — fetch data, call LLM, assemble report
- **NemoClaw blueprints**: Define WHERE agents run — Ubuntu version, network policy, filesystem mounts

They're complementary. You could theoretically run your `small-cap:pre-market-scan` blueprint inside a NemoClaw sandbox.

---

## Follow-up Research: NVIDIA NeMo Guardrails

**Researched**: 2026-03-17 (Follow-up)  
**Sources**: GitHub, NVIDIA docs  
**Context**: Your trading terminal's agentic framework

---

### Concept Overview

**NeMo Guardrails** is an **open-source Python toolkit** (not TypeScript like NemoClaw) for adding *programmable guardrails* to LLM-based conversational applications. Unlike NemoClaw (which is infrastructure/runtime security), Guardrails sits **between your application code and the LLM** to control outputs.

Think of it as: "Middleware for LLM outputs" — it intercepts user input and LLM responses, applies rules, and can reject, modify, or redirect them.

**Key difference from NemoClaw**:
- **NemoClaw**: Secures WHERE agents run (sandboxing, network policies)
- **Guardrails**: Controls WHAT agents say (output validation, dialog flows, safety checks)

---

### What It Actually Is

**Guardrails (or "rails")** are programmable controls applied at different stages of the LLM interaction:

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│  User Input  │────▶│ Input Rails  │────▶│     LLM      │────▶│ Output Rails │────▶ Response
└──────────────┘     └──────────────┘     └──────────────┘     └──────────────┘
                            │                                          │
                     (can reject/alter                        (can reject/alter
                      user input)                               LLM output)
```

**Five types of rails**:
1. **Input rails** — applied to user input (e.g., jailbreak detection, PII masking)
2. **Dialog rails** — influence how the LLM is prompted (e.g., predefined conversation flows)
3. **Retrieval rails** — applied to RAG chunks (e.g., filter sensitive documents)
4. **Execution rails** — applied to tool/action inputs and outputs
5. **Output rails** — applied to LLM responses (e.g., fact-checking, hallucination detection)

---

### How It Works

**Colang**: A Python-like domain-specific language for defining dialog flows:

```colang
# greeting.co
define user express greeting
  "Hello!"
  "Good afternoon!"

define flow user express greeting
  bot express greeting
  bot offer to help

define bot express greeting
  "Hello there!"

define bot offer to help
  "How can I help you today?"
```

**Configuration** (`config.yml`):

```yaml
models:
  - type: main
    engine: openai
    model: gpt-3.5-turbo-instruct

rails:
  input:
    flows:
      - check jailbreak
      - mask sensitive data on input
  
  output:
    flows:
      - self check facts
      - self check hallucination
      - activefence moderation on input

  on-input-config:
    sensitive_data_detection:
      input:
        entities:
          - PERSON
          - EMAIL_ADDRESS
```

**Python API**:

```python
from nemoguardrails import LLMRails, RailsConfig

# Load config
config = RailsConfig.from_path("path/to/config")
rails = LLMRails(config)

# Generate with guardrails applied
completion = rails.generate(
    messages=[{"role": "user", "content": "Hello world!"}]
)
# Output: {"role": "assistant", "content": "Hi! How can I help you?"}
```

---

### In Your Codebase Context

**Current state**:
- You have basic circuit breaker pattern in `lib/jarvis/circuit-breaker.ts`
- No input/output validation beyond Zod schemas
- No dialog flow management
- No safety checks on LLM outputs

**How Guardrails fits**:

| Your Component | Guardrails Equivalent | Fit |
|----------------|------------------------|-----|
| `lib/jarvis/circuit-breaker.ts` | Output rails + fact-checking | Direct replacement |
| Zod validation (`lib/validations/`) | Input rails | Can complement |
| Blueprint `llm` steps | Rails-wrapped LLM calls | Add as middleware |
| Agent memory/context | Dialog rails | New capability |

**Integration opportunities**:

**1. Replace circuit breaker with guardrails** (`lib/jarvis/circuit-breaker.ts`):

Your current:
```typescript
// lib/jarvis/circuit-breaker.ts
class CircuitBreaker {
  private failures = 0;
  private threshold = 5;
  private resetTimeout = 60000;
  // ... basic failure counting
}
```

With Guardrails:
```python
# nemoguardrails output rails
output:
  flows:
    - self check facts
    - self check hallucination
    - check trading_advice_safety  # Custom rail for financial advice
```

**2. Add input validation for chat** (`app/api/agents/chat/route.ts`):

Your current: Zod schema validation only

With Guardrails:
```yaml
rails:
  input:
    flows:
      - check jailbreak
      - check prompt_injection
      - mask sensitive data on input  # PII detection
```

**3. Dialog flow for research reports**:

Your agents produce reports → user reviews → approve/reject.

Guardrails could enforce:
```colang
# research_report.co
define user request research
  "Research ticker NVDA"
  "Analyze dilution for AAPL"

define flow user request research
  bot confirm scope
  bot execute research
  bot present findings
  user review findings

define bot confirm scope
  "I'll research NVDA dilution. This will take ~30 seconds. Continue?"
```

---

### Code Examples

**Basic setup**:

```bash
# Install
pip install nemoguardrails  # Python only

# Project structure
my-agent/
├── config/
│   ├── config.yml
│   ├── actions.py          # Custom Python actions
│   ├── config.py           # Custom initialization
│   └── rails.co            # Colang dialog definitions
```

**Config for trading agents**:

```yaml
# config/config.yml
models:
  - type: main
    engine: openai
    model: gpt-4
    api_key: ${OPENAI_API_KEY}
  
  # Use your NVIDIA API
  - type: main
    engine: nvidia
    model: deepseek-v3.2
    api_key: ${AGENT_API_KEY}
    base_url: https://integrate.api.nvidia.com/v1

rails:
  input:
    flows:
      - check jailbreak
      - mask sensitive data on input
  
  output:
    flows:
      - self check facts
      - check financial_advice_disclaimer
```

**Custom action (Python)**:

```python
# config/actions.py
from nemoguardrails import RailsConfig, action

@action()
async def check_financial_advice_disclaimer(context: dict) -> bool:
    """Custom rail: Ensure trading advice includes disclaimer"""
    bot_response = context.get("bot_message", "")
    
    disclaimer_required = any(word in bot_response.lower() 
                              for word in ["buy", "sell", "hold", "recommend"])
    
    if disclaimer_required and "not financial advice" not in bot_response.lower():
        return False  # Block response
    
    return True  # Allow response
```

**Server mode** (OpenAI-compatible API):

```bash
# Start guardrails server
nemoguardrails server --config ./config --port 8000

# Use with your existing client
POST /v1/chat/completions
{
  "config_id": "trading-agent",
  "messages": [{"role": "user", "content": "Should I buy NVDA?"}]
}
```

---

### Best Practices

1. **Use Guardrails for safety, not business logic**
   Don't move your trading algorithms into Colang. Use rails for: jailbreak detection, hallucination checks, output moderation.

2. **Combine with your blueprint pattern**
   Guardrails wraps the LLM call. Your blueprints define the workflow. They're complementary:
   ```
   Blueprint Step 3: analyze-dilution
     └─> Call LLM via Guardrails
           └─> Guardrails applies output rails
                 └─> Returns validated response
   ```

3. **Start with built-in rails**
   Don't write custom rails immediately. Use: `self check facts`, `check jailbreak`, `mask sensitive data`.

4. **Test rails independently**
   Each rail can be tested separately before integrating into the full pipeline.

5. **Monitor rail performance**
   Some rails add latency (fact-checking requires additional LLM calls). Track which rails are slowest.

---

### Common Pitfalls

**Pitfall**: Confusing Guardrails with your circuit breaker  
**Reality**: Circuit breaker (your current pattern) stops calling LLM after failures. Guardrails validates outputs. Use both:
- Guardrails validates LLM outputs (safety, accuracy)
- Circuit breaker stops calling broken LLM endpoints (reliability)

**Pitfall**: Trying to use Guardrails with TypeScript  
**Reality**: Python only. Your Next.js app would need to call a Python service (adds complexity).

**Pitfall**: Over-engineering Colang flows  
**Reality**: Don't replace your agent blueprints with Colang. Use Colang for: conversation starters, safety interjections, simple confirmations.

**Pitfall**: Expecting Guardrails to fix hallucinations  
**Reality**: Fact-checking rails reduce but don't eliminate hallucinations. Still need human review (your `pending_review` reports).

---

### Related Topics

- **Your `lib/jarvis/circuit-breaker.ts`** — Complementary (reliability vs safety)
- **NemoClaw** — Different layer (runtime security vs output validation)
- **LangChain** — Guardrails integrates with it, but you don't use LangChain
- **Your `AGENTIC_EXPANSION_V2.md` blueprints** — Higher-level workflow definition

---

### Follow-up Questions

#### Q: Should I use Guardrails for my trading agents?

**Asked**: 2026-03-17  
**Answer**: Maybe for output validation, but adds complexity:

| Feature | Your Current | With Guardrails |
|---------|-------------|-----------------|
| Circuit breaker | Yes (`lib/jarvis/circuit-breaker.ts`) | No (different concern) |
| Output validation | No | Yes (fact-check, hallucination) |
| Input validation | Zod only | + jailbreak detection |
| Dialog flows | No | Yes (if needed) |
| Language | TypeScript | Python (new service) |
| Complexity | Low | Medium (adds Python service) |

**Verdict**: 
- **Phase 1**: Skip it. Your `pending_review` reports already handle output validation via human oversight.
- **Phase 2**: Consider adding if you want automated fact-checking before human review.

#### Q: What's the difference between Guardrails and my blueprint pattern?

**Asked**: 2026-03-17  
**Answer**: Different abstraction levels:

| Your Blueprints | Guardrails |
|---------------|------------|
| Orchestrate agent workflow | Wrap individual LLM calls |
| Define sequence of steps | Define input/output rules |
| Mix of `code` and `llm` steps | Applied only to `llm` steps |
| Your custom implementation | NVIDIA maintained library |
| Written in TypeScript | Written in Python |

**Integration**: Guardrails could wrap your `llm` blueprint steps:
```typescript
// Your blueprint
const blueprint = {
  steps: [
    { type: 'code', run: fetchData },
    { type: 'llm', run: withGuardrails(analyzeData) },  // Wrapped
    { type: 'code', run: assembleReport }
  ]
}
```

---

## Summary: NemoClaw vs NeMo Guardrails vs Your Architecture

| Tool | Layer | Purpose | Your Fit |
|------|-------|---------|----------|
| **NemoClaw** | Infrastructure | Secure agent runtime (sandboxing) | Phase 2 (if need compliance) |
| **NeMo Guardrails** | Application | LLM output validation & dialog flows | Optional (human review suffices) |
| **Your Blueprints** | Orchestration | Agent workflow definition | Core architecture (keep) |
| **Your Circuit Breaker** | Reliability | Fail fast on LLM errors | Keep (complementary) |

**Recommendation**: 
1. Build your Docker-based agents first (`AGENTIC_EXPANSION_V2.md`)
2. Add Guardrails only if you need automated output validation
3. Consider NemoClaw only for compliance/audit requirements

---

*To continue learning, use: `/research OpenClaw vs OpenAI agents` or `/research LLM output validation patterns`*