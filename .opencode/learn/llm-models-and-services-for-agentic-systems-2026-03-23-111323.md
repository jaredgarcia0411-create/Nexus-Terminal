# LLM Models and Services for Agentic Systems Crash Course
**Researched**: March 23, 2026
**Sources**: Groq Docs, OpenRouter, Llama.cpp, CrewAI, LangGraph, Anthropic, Nexus Terminal codebase analysis
**Context**: Agentic systems for trading/financial analysis, cost-sensitive, need for reliable tool use

---

## Concept Overview
Agentic systems require LLMs that can reason, use tools, and maintain context over extended conversations. Unlike standard chat models, agentic models excel at planning, decision-making, and orchestrating complex workflows involving external tools and APIs.

## How It Works
Agentic LLMs are typically fine-tuned on instruction-following, tool-use, and reasoning datasets. They use specialized prompting patterns (ReAct, Chain-of-Thought, Plan-and-Execute) and often include built-in support for function calling/JSON mode output. Services provide APIs for these models with varying latency, cost, and reliability characteristics.

## How It Applies Here
Nexus Terminal's Jarvis AI system (`lib/jarvis/client.ts:3`) currently uses Groq's `llama-3.3-70b-versatile` model via `https://api.groq.com/openai/v1/chat/completions`. This setup works but may be expensive and lacks local/offline capabilities. For a trading platform with sensitive data, consider:
1. **Cost optimization**: Switch to cheaper models during low-risk analysis
2. **Privacy**: Use local models for sensitive trade analysis
3. **Reliability**: Add fallback providers for critical workflows
4. **Specialization**: Fine-tune models on trading-specific data

## Codebase Evidence
- `lib/jarvis/client.ts:3` - Uses Groq's `llama-3.3-70b-versatile` with `DEFAULT_BASE_URL = 'https://api.groq.com/openai/v1/chat/completions'`
- `lib/jarvis/client.ts:37` - Configurable timeout via `JARVIS_TIMEOUT_MS` env variable
- `lib/jarvis/client.ts:44-47` - `JarvisClientResult` interface returns content and model used
- `lib/jarvis/types.ts` - Structured interfaces for trade analysis, macro summaries, and memory
- Current system uses OpenAI-compatible API pattern with streaming, circuit breaking, and token tracking

## Current Best LLM Models for Agentic Systems

### Top Tier (High Reasoning, Reliable Tool Use)
1. **Groq Llama-3.3-70b-versatile** (Current choice)
   - **Strengths**: Fast inference (Groq LPU), good reasoning, reliable tool use
   - **Weaknesses**: Cost ($0.59/1M tokens input, $0.79/1M tokens output), Groq-specific
   - **Source**: Groq Docs, Nexus Terminal implementation

2. **Claude 3.5 Sonnet** (Anthropic)
   - **Strengths**: Best-in-class reasoning, excellent at complex planning, strong safety
   - **Weaknesses**: Expensive ($3/1M tokens input, $15/1M tokens output), rate limited
   - **Source**: Anthropic Claude platform

3. **GPT-4o/4o-mini** (OpenAI via OpenRouter)
   - **Strengths**: Widely supported, excellent tool use via function calling
   - **Weaknesses**: Expensive, OpenAI policy restrictions on financial advice
   - **Source**: OpenRouter model listings

### Cost-Effective Alternatives
1. **Llama 3.1 8B/70B** (via OpenRouter/Together AI)
   - **Cost**: ~$0.10-0.30/1M tokens
   - **Performance**: Good for simpler agent tasks, weaker at complex reasoning
   - **Source**: OpenRouter pricing

2. **Gemma 2 9B/27B** (Google)
   - **Cost**: ~$0.15-0.40/1M tokens
   - **Performance**: Strong for coding/analysis, weaker at planning
   - **Source**: Various providers

3. **DeepSeek Coder/Reasoner** (via Together AI)
   - **Cost**: ~$0.20-0.50/1M tokens
   - **Performance**: Excellent at coding/tool use, weaker at creative tasks
   - **Source**: Together AI models

## NVIDIA API Alternatives

### OpenRouter
- **Model**: Aggregator across 100+ models from OpenAI, Anthropic, Google, Meta, etc.
- **Pricing**: Transparent, pay-as-you-go, often cheaper than direct APIs
- **Features**: Unified API, model comparison, automatic fallback
- **Best for**: Cost optimization, model switching without code changes
- **URL**: https://openrouter.ai/models

### Together AI
- **Model**: Specializes in open-source models (Llama, Mistral, CodeLlama, etc.)
- **Pricing**: Competitive, especially for inference-optimized models
- **Features**: Fine-tuning, embeddings, RAG pipelines
- **Best for**: Open-source focus, custom fine-tuning
- **URL**: https://docs.together.ai/docs/models

### Groq (Current Provider)
- **Model**: Llama, Mixtral, Gemma with LPU inference engine
- **Pricing**: $0.59/$0.79 per 1M tokens (input/output)
- **Features**: Ultra-low latency (500+ tokens/sec), tool use, compound AI
- **Best for**: Real-time applications, trading where speed matters
- **URL**: https://docs.groq.com/docs/models

### Anthropic Claude API
- **Model**: Claude 3.5 Sonnet, Haiku, Opus
- **Pricing**: $3/$15 per 1M tokens (Sonnet), cheaper for Haiku
- **Features**: Best reasoning, 200K context, constitutional AI
- **Best for**: Complex planning, safety-critical applications
- **URL**: https://platform.claude.com/

## Local Model Options

### llama.cpp (C/C++ Inference)
- **Performance**: Optimized for CPU/GPU, supports quantization (Q4_0, Q8_0, etc.)
- **Hardware**: 8GB+ RAM for 7B models, 32GB+ for 70B, CUDA/Metal acceleration
- **Models**: Llama, Mistral, Gemma, Qwen, DeepSeek (GGUF format)
- **Best for**: Privacy, offline use, cost elimination
- **URL**: https://github.com/ggerganov/llama.cpp

### Ollama
- **Performance**: User-friendly wrapper around llama.cpp
- **Hardware**: Similar requirements, easier setup
- **Models**: Curated selection with easy pull/run commands
- **Best for**: Quick prototyping, developer-friendly local inference
- **URL**: https://github.com/ollama/ollama

### LM Studio
- **Performance**: GUI application, easy model management
- **Hardware**: Similar, with nice UI for model selection/chat
- **Models**: Downloads from Hugging Face, converts to GGUF
- **Best for**: Non-technical users, experimentation
- **URL**: https://lmstudio.ai/

### Hardware Requirements
- **7B models**: 8GB RAM, any modern CPU (runs ~5-10 tokens/sec on CPU)
- **13B models**: 16GB RAM, better with GPU (NVIDIA 8GB+)
- **70B models**: 32GB+ RAM, requires GPU (NVIDIA 24GB+ for full precision)
- **Quantization**: Q4_0 reduces size 4x with minimal quality loss
- **Apple Silicon**: Excellent via Metal backend (M1/M2/M3)

## Cost Comparison for Agent Workloads

| Provider | Model | Input/M | Output/M | Monthly 100K convos* | Reliability |
|----------|-------|---------|----------|----------------------|-------------|
| Groq | Llama-3.3-70b | $0.59 | $0.79 | ~$1,380 | High (LPU) |
| OpenRouter | GPT-4o-mini | $0.15 | $0.60 | ~$750 | High |
| Together AI | Llama-3.1-70B | $0.30 | $0.30 | ~$600 | Medium |
| Anthropic | Claude 3.5 Sonnet | $3.00 | $15.00 | ~$18,000 | High |
| Local | Llama-3.1-70B-Q4 | $0 | $0 | HW cost | Variable |

*Assumes 100K conversations @ 1K input + 500 output tokens each

### Reliability Considerations
1. **Groq**: High uptime, but proprietary LPU hardware
2. **OpenRouter**: Aggregator reliability depends on upstream providers
3. **Local**: 100% uptime but requires maintenance, slower inference
4. **Anthropic/OpenAI**: Enterprise-grade but expensive

## Specialized Agent Frameworks

### CrewAI vs Custom Implementation
**CrewAI** (https://github.com/crewAIInc/crewAI):
- **Pros**: Built for multi-agent collaboration, role-playing agents, hierarchical processes, YAML config
- **Cons**: Python-only, newer framework, less battle-tested than LangChain
- **Best for**: Complex multi-agent workflows with clear roles (research → analysis → reporting)

**LangGraph** (https://docs.langchain.com/langgraph/):
- **Pros**: Low-level orchestration, durable execution, human-in-the-loop, state management
- **Cons**: Steep learning curve, requires more boilerplate
- **Best for**: Production agent systems needing state persistence, interruption handling

**Custom Implementation** (Current Nexus Terminal approach):
- **Pros**: Full control, optimized for specific use case, no framework overhead
- **Cons**: Maintenance burden, reinvent wheels, harder to scale
- **Current**: Simple OpenAI-compatible client with circuit breaking, token tracking

### Framework Recommendation
For Nexus Terminal's trading focus:
1. **Keep custom for core Jarvis**: Already works, tailored to trading needs
2. **Add LangGraph for complex workflows**: If implementing multi-step research → analysis → execution pipelines
3. **Consider CrewAI for**: If building separate analysis agents with specialized roles

## Code Examples

### Switching from Groq to OpenRouter
```typescript
// lib/jarvis/client.ts modifications
const DEFAULT_MODEL = 'openrouter/llama-3.1-70b';
const DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1/chat/completions';

// Add model fallback logic
async function requestLlmWithFallback(systemPrompt: string, userMessage: string, temperature: number) {
  const providers = [
    { model: 'openrouter/llama-3.1-70b', baseUrl: 'https://openrouter.ai/api/v1/chat/completions' },
    { model: 'groq/llama-3.3-70b-versatile', baseUrl: 'https://api.groq.com/openai/v1/chat/completions' },
    { model: 'gpt-4o-mini', baseUrl: 'https://api.openai.com/v1/chat/completions' }
  ];
  
  for (const provider of providers) {
    try {
      return await requestLlm(systemPrompt, userMessage, temperature, provider.model, provider.baseUrl);
    } catch (error) {
      console.warn(`Provider ${provider.model} failed, trying next`);
      continue;
    }
  }
  throw new Error('All LLM providers failed');
}
```

### Local Inference with llama.cpp
```bash
# Download and run Llama 3.1 8B locally
wget https://huggingface.co/TheBloke/Llama-3.1-8B-GGUF/resolve/main/llama-3.1-8b.Q4_0.gguf
./llama-server -m llama-3.1-8b.Q4_0.gguf --port 8080
```

```typescript
// Connect Jarvis to local server
const LOCAL_MODEL = 'local/llama-3.1-8b';
const LOCAL_BASE_URL = 'http://localhost:8080/v1/chat/completions';

// Use for sensitive analysis while keeping Groq for general chat
function getModelForTask(taskType: 'trade_analysis' | 'general_chat'): { model: string, baseUrl: string } {
  if (taskType === 'trade_analysis' && process.env.USE_LOCAL_LLM === 'true') {
    return { model: LOCAL_MODEL, baseUrl: LOCAL_BASE_URL };
  }
  return { model: DEFAULT_MODEL, baseUrl: DEFAULT_BASE_URL };
}
```

## Best Practices
1. **Circuit breaking**: Already implemented in `lib/jarvis/circuit-breaker.ts`
2. **Token tracking**: Implement in `lib/jarvis/token-tracking.ts` for cost monitoring
3. **Provider fallback**: Essential for trading platform reliability
4. **Task-specific models**: Use cheaper/faster models for simple tasks, powerful ones for complex analysis
5. **Local for sensitive data**: Run trade analysis locally, general chat via API
6. **Cache frequent queries**: Already done via `askedgar_cache` table pattern
7. **Streaming responses**: Already implemented for better UX

## Common Pitfalls
**Pitfall**: Vendor lock-in with single provider
**Solution**: Implement provider abstraction layer with fallback logic

**Pitfall**: Uncontrolled LLM costs
**Solution**: Add token budgeting, usage alerts, switch to cheaper models for non-critical tasks

**Pitfall**: Slow local inference hurting UX
**Solution**: Use quantization (Q4_0), GPU acceleration, or hybrid approach (local for batch, cloud for real-time)

**Pitfall**: Framework complexity overwhelming simple needs
**Solution**: Start custom, only adopt frameworks when clear pain points emerge

## Recommended Default Approach
For Nexus Terminal's current scale and use case:

1. **Keep Groq as primary**: Fast, reliable, already integrated
2. **Add OpenRouter as fallback**: For cost savings and redundancy
3. **Experiment locally**: Set up llama.cpp/Ollama for sensitive trade analysis
4. **Monitor costs**: Implement token tracking with monthly budgets
5. **Postpone frameworks**: Custom implementation works well; revisit if building multi-agent systems

Migration priority:
1. ✅ Keep current Groq integration
2. ⬜ Add OpenRouter fallback (low effort, high value)
3. ⬜ Set up local Llama 3.1 8B for trade analysis (medium effort)
4. ⬜ Implement cost tracking/alerts (medium effort)
5. ⬜ Evaluate CrewAI/LangGraph only if multi-agent needed

## Action Checklist
- [ ] **Short term**: Add OpenRouter API key to `.env.local`
- [ ] **Short term**: Implement provider fallback in `lib/jarvis/client.ts`
- [ ] **Medium term**: Set up local llama.cpp server for testing
- [ ] **Medium term**: Add token cost tracking dashboard
- [ ] **Long term**: Evaluate fine-tuning Llama on trading data if usage grows

## Known Unknowns
- Exact performance difference between Groq LPU and standard GPU inference
- Local model quality for financial analysis vs API models
- CrewAI/LangGraph learning curve for TypeScript/Node.js implementation
- Compliance implications of using different models for financial advice

## Related Topics
- Fine-tuning LLMs on trading data
- RAG (Retrieval Augmented Generation) for market research
- Agent memory and context management
- LLM evaluation and testing frameworks

## Follow-up Questions
*To continue learning, use: `/research more about [Topic]` or ask follow-up questions*

---
*Research conducted via parallel subagents analyzing official docs, codebase patterns, and industry frameworks*