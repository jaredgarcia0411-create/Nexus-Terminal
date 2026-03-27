# Quantization, Local LLMs, and Running Agents on Consumer Hardware

> Generated: 2026-03-26 | Context: AGENTIC_EXPANSION_V2.md future planning

---

## The Big Picture (TL;DR)

**Can you run your Nexus Terminal agents on a local LLM instead of paying for cloud APIs?**

Yes, but with tradeoffs. Here's the honest answer:

- **Simple agent tasks** (summarize trade data, generate boilerplate, simple Q&A) — local models handle these fine today
- **Complex agentic work** (multi-step reasoning, error recovery, autonomous tool-calling chains) — local models still fail 2-4x more often than cloud APIs like Claude or GPT-5
- **You don't have to quantize models yourself** — pre-quantized models are available for free download from HuggingFace, Ollama, and others
- **Your AGENTIC_EXPANSION_V2.md is already set up for this** — the "provider-agnostic LLM" design means swapping from NVIDIA API to a local llama.cpp server is literally a config change
- **Google's TurboQuant (announced March 25, 2026) is exciting but targets a different problem** — it compresses runtime memory (KV cache), not model weights. It's complementary to weight quantization, not a replacement.

---

## Part 1: What is Quantization?

An LLM is essentially a massive table of numbers (called **weights**). Each weight describes how strongly one neuron connects to another. Quantization is about using fewer bits to store each number.

Think of it like image quality:
- **FP32 (32-bit)** = RAW photo. Every detail preserved. Nobody uses this for inference anymore.
- **FP16 (16-bit)** = High-quality JPEG. The standard baseline. A 7B-parameter model = ~14GB.
- **INT8 (8-bit)** = Good JPEG. Model shrinks to ~7GB for 7B. Quality loss is nearly imperceptible.
- **INT4 (4-bit)** = Compressed JPEG. Model shrinks to ~4GB for 7B. 75% smaller than FP16. Some quality loss, especially on hard tasks like coding and math.

**The key insight:** Most of those billions of numbers don't need 16 decimal places of precision. You can round them down to 4-8 bits and the model still works remarkably well.

### The Three Main Quantization Formats

| Format | Best for | How it works |
|--------|----------|--------------|
| **GGUF** | Desktop/laptop use (llama.cpp, Ollama) | Single portable file with weights + tokenizer. CPU-first with GPU acceleration. The dominant format for personal use. |
| **GPTQ** | NVIDIA GPU inference | Uses math (Hessian matrix) to figure out which weights matter most, minimizes rounding error. GPU-optimized. |
| **AWQ** | NVIDIA GPU, best quality | Identifies the ~1% of weights that matter most, scales them up before quantizing. Slightly better quality than GPTQ at same bit depth. |

### GGUF Quality Levels (the ones you'll actually see)

| Level | Bits | 7B file size | Quality loss | Notes |
|-------|------|-------------|--------------|-------|
| Q8_0 | 8 | ~7.2GB | Negligible | Near-lossless. Use if you have the VRAM. |
| Q6_K | 6 | ~5.5GB | Tiny | Excellent quality |
| Q5_K_M | 5 | ~4.8GB | Small | Recommended default for quality-sensitive work |
| **Q4_K_M** | **4** | **~4.1GB** | **Moderate** | **The mainstream sweet spot — most people use this** |
| Q3_K_M | 3 | ~3.3GB | Noticeable | Degraded. Only if you're memory-constrained. |

The naming decode: `Q4` = 4-bit, `K` = k-quant (grouped quantization — applies different precision to different layers based on sensitivity), `M` = medium variant (critical layers get higher precision).

---

## Part 2: Google's TurboQuant (March 25, 2026)

This made headlines this week and crashed memory chip stocks. Here's what it actually is:

### What it compresses: KV Cache, NOT model weights

This is the critical distinction. Standard quantization (GPTQ, AWQ, GGUF) compresses the **model weights** — the permanent parameters that define the model. TurboQuant compresses the **KV cache** — the temporary memory buffer that grows as the model processes a conversation.

Think of it this way:
- **Model weights** = the model's brain (permanent, loaded once)
- **KV cache** = the model's short-term memory of the current conversation (grows with every token)

For long conversations or documents, KV cache can eat MORE memory than the model weights themselves. TurboQuant shrinks that runtime memory by 6x.

### How it works (simplified)

**Stage 1 — PolarQuant:** Instead of compressing numbers in the usual way (x, y, z coordinates), it converts them to polar coordinates (radius + angles). The angles in attention heads turn out to be highly predictable, so they compress cheaply.

**Stage 2 — QJL (error correction):** A mathematical trick that compresses the remaining error down to a single bit per value.

**Result:** 3-bit KV cache storage with zero accuracy loss. No retraining needed. Works on any transformer model.

### Why it matters for you

- **Longer context windows on existing hardware** — a model that previously ran out of memory processing long documents can now handle 6x more context
- **It's complementary to weight quantization** — you can use GGUF Q4 for model weights AND TurboQuant for KV cache. They stack.
- **Already ported to llama.cpp** — community ports appeared within 24 hours of the paper
- **Model-agnostic** — works on Llama, Mistral, Qwen, Gemma, anything transformer-based

### What it doesn't do

- Does NOT make model weights smaller (that's still GGUF/GPTQ/AWQ's job)
- Does NOT improve model quality — just makes the same quality use less runtime memory
- The biggest gains are on long-context workloads. For short conversations, KV cache is small anyway.

---

## Part 3: Do You Have to Quantize Models Yourself?

**No.** Pre-quantized models are freely available and this is how most people do it.

### Where to get pre-quantized models

| Source | Format | How to use |
|--------|--------|------------|
| **Ollama library** (ollama.com/library) | GGUF (pre-packaged) | `ollama pull qwen2.5-coder:14b` — one command |
| **bartowski** (HuggingFace) | GGUF | The most prolific quantizer. Has every major model within hours of release. |
| **unsloth** (HuggingFace) | GGUF, 4-bit Safetensor | Their "Dynamic 2.0" GGUFs apply per-layer decisions for better quality |
| **LM Studio** | GGUF (built-in browser) | GUI app — browse, download, run. Shows estimated VRAM before download. |
| **TheBloke** (HuggingFace) | GGUF, GPTQ | Massive back-catalog, less active on new releases |

**You would only quantize yourself if:**
1. You fine-tuned your own model and need to compress it
2. You want a specific quant level that nobody published yet
3. You're doing research

For your use case — just download pre-quantized models from Ollama or HuggingFace. It's a solved problem.

---

## Part 4: Hardware Requirements

### The core rule: the model must fit in GPU VRAM for good speed

If it fits in VRAM → fast (20-100+ tokens/second).
If it spills to system RAM → slow (5-15 tokens/second).
CPU-only → functional but painful.

### What fits where (Q4_K_M quantization)

| Model size | File size | Min VRAM | Example GPUs | Speed (approx) |
|-----------|-----------|----------|-------------|-----------------|
| 7-8B | ~4-5GB | 6GB | RTX 3060 12GB, RTX 4060 | 80-120 tok/s |
| 13-14B | ~7-8GB | 10GB | RTX 3060 12GB, RTX 4070 | 50-75 tok/s |
| 30-34B | ~17-20GB | 20GB | RTX 4090 24GB | 20-35 tok/s |
| 70B | ~38-40GB | 40GB | Dual RTX 4090, or partial CPU offload on single 4090 (~7-15 tok/s) | 20-35 tok/s (dual) |

### Your setup: 16GB RAM laptop on WSL2

With 16GB total system RAM and no dedicated GPU, you're looking at:
- **7-8B models at Q4** — will run, but on CPU only. Expect ~8-15 tokens/second. Functional for testing, too slow for production agent loops.
- **13B+ models** — will struggle or fail to load. Not enough RAM headroom after OS + WSL2 overhead.

**If you add a GPU later:**
- RTX 4060 Ti 16GB (~$400-450) — runs 7-14B models comfortably
- RTX 4070 Ti Super 16GB (~$750-800) — faster, same model range
- RTX 4090 24GB (~$1,800-2,000) — the sweet spot. Runs 30B+ models, handles complex agentic workloads

---

## Part 5: Best Models for Your Agentic Use Case

For trading agents that need tool-calling, multi-step reasoning, and code generation:

### Practical tier (fits on consumer hardware)

| Model | Params | Why it's good | VRAM needed (Q4) |
|-------|--------|---------------|-----------------|
| **Qwen3-30B-A3B** | 30B total, 3B activated (MoE) | Strong reasoning + tool calling, tiny memory footprint due to MoE | 8-12GB |
| **Qwen2.5-Coder-14B** | 14B | Well-proven for code, widely tested in agent pipelines | ~8-10GB |
| **DeepSeek-R1-Distill-Qwen-14B** | 14B | Good multi-step analysis from DeepSeek's reasoning distillation | ~8-10GB |
| **Mistral-7B / Nemo-12B** | 7-12B | Lean, fast, solid for simple tool calling | 6-8GB |

### The honest comparison vs cloud APIs

| Capability | Claude Sonnet 4.6 / GPT-5 | Best Local (Qwen3-30B Q4) |
|------------|---------------------------|---------------------------|
| Multi-step tool chaining | Robust, handles error recovery | Fragile past ~5-7 steps |
| JSON/schema adherence | Very high | Moderate — needs retry logic |
| Context window (practical) | 200K+ tokens | 32K-128K, degrades hard at 100K |
| Financial reasoning | Strong domain generalization | Weaker, needs explicit prompting |
| Speed | ~100-200 tok/s (API) | 30-80 tok/s (local GPU) |
| Failure rate (agentic tasks) | Low | 41-87% failure rate reported in multi-agent systems |

**The gap is real but closing.** Simple tasks (summarize, write a function, answer a question) — local models are close. Complex autonomous agents (plan, execute, recover from errors, chain tool calls) — cloud APIs are still significantly better.

---

## Part 6: The Practical Setup (What You'd Actually Do)

### For experimentation today (your 16GB RAM laptop)

```bash
# Install Ollama on WSL2
curl -fsSL https://ollama.com/install.sh | sh

# Pull a small model
ollama pull qwen2.5-coder:7b

# It now serves an OpenAI-compatible API at localhost:11434
# Your AGENTIC_EXPANSION_V2 LLM wrapper already supports this
```

This gives you a local model to test against, but performance will be CPU-bound and slow.

### For production local agents (future, with GPU)

```bash
# Ollama with GPU — automatically detects CUDA on WSL2
ollama pull qwen3:30b-a3b-q4_K_M

# Or for more control, use llama.cpp directly
# Your V2 architecture already supports llama.cpp as a provider
```

### The hybrid approach (recommended)

Your AGENTIC_EXPANSION_V2.md already has this built in:

> "The LLM wrapper detects provider from URL. Swapping from NVIDIA API to a local llama.cpp server is a config change."

The smart play is **LiteLLM** or your existing provider-agnostic wrapper to route:
- **Complex tasks** (trade analysis, multi-step reasoning) → cloud API (Claude, DeepSeek)
- **Simple tasks** (summarization, formatting, basic Q&A) → local model
- **Sensitive data** (if you ever process account data) → local model (never leaves your machine)

This isn't theoretical — it's what teams are actually doing in 2026.

---

## Part 7: Cost Comparison

### Cloud API costs (March 2026)

| Provider | Input cost | Output cost |
|----------|-----------|-------------|
| Claude Sonnet 4.6 | $3/1M tokens | $15/1M tokens |
| GPT-5 | ~$10/1M | ~$30/1M |
| DeepSeek API (hosted) | $0.14/1M | $0.14/1M |
| NVIDIA API (your current provider) | Varies by model | Varies |

### Local LLM costs

- **Hardware:** RTX 4090 ~$1,800-2,000 new
- **Electricity:** ~$40/month at 4hrs/day usage
- **Model files:** Free (open weights from Meta, Alibaba, Mistral, Google)

### Break-even

- vs Claude Sonnet: ~1.5-2M tokens/month to pay off hardware in 12 months
- vs DeepSeek API ($0.14/1M): local almost never beats it on pure cost — hardware ROI stretches to 3-5 years

**The real case for local isn't cost.** It's:
1. **Privacy** — data never leaves your machine
2. **No rate limits** — run as fast as your hardware allows
3. **No downtime** — no API outages
4. **Latency** — no network round-trip

---

## Part 8: What This Means for AGENTIC_EXPANSION_V2

### What you got right

1. **Provider-agnostic LLM wrapper** — already designed for exactly this scenario
2. **llama.cpp support mentioned** — the architecture accounts for local models
3. **Blueprint-driven handlers with minimal LLM calls** — this is critical. The fewer LLM calls, the less local model weaknesses matter. Your "code owns truth, LLM owns judgment" principle means the LLM only does what it's best at.
4. **Docker Compose on home server** — Ollama can run as another Docker service alongside your agents

### What to think about for the future

1. **Start with cloud, add local later** — your V1 should use NVIDIA API / DeepSeek as planned. The architecture already supports swapping in local models when you're ready.
2. **GPU upgrade is the bottleneck** — on 16GB RAM with no GPU, local inference is too slow for agent loops. An RTX 4060 Ti ($400) would unlock viable 7-14B local models.
3. **MoE models are your friend** — Qwen3-30B-A3B activates only 3B parameters despite being a 30B model. This means near-7B-model memory usage with 30B-model quality. Perfect for memory-constrained setups.
4. **TurboQuant will help with context** — when your agents process long conversations or documents, TurboQuant's KV cache compression (already being ported to llama.cpp) will let you handle longer contexts without running out of memory.
5. **The hybrid routing pattern is the endgame** — route simple tasks to cheap local models, complex tasks to cloud APIs. Your LLM wrapper just needs a routing decision.

---

## Is This Too Complex for You?

**No, but the timing matters.**

- **Running a pre-quantized model locally:** Dead simple. Install Ollama, run one command, you have a local LLM. You could do this today.
- **Quantizing models yourself:** Not needed. Pre-quantized models are everywhere.
- **Building a hybrid cloud/local agent system:** Your architecture already supports it. It's a config change, not a code change.
- **Buying/configuring GPU hardware for WSL2:** Moderate effort — GPU passthrough on WSL2 is well-documented and mostly "just works" with NVIDIA cards in 2026.

The recommendation: **don't add local LLM support to your V1 scope.** Build V1 with cloud APIs as planned. When V1 is working and you want to reduce costs or add privacy, drop in Ollama + a quantized Qwen model. Your architecture is ready for it.

---

## Key Terms Glossary

| Term | Plain English |
|------|--------------|
| **Quantization** | Compressing model numbers from high precision (16-32 bit) to low precision (4-8 bit) to save memory |
| **GGUF** | File format for quantized models. The .mp4 of local LLMs — one file, everything included |
| **GPTQ / AWQ** | GPU-optimized quantization methods. More complex than GGUF but faster on NVIDIA cards |
| **KV Cache** | The model's short-term memory of the current conversation. Grows with every token processed |
| **TurboQuant** | Google's new technique to compress KV cache (runtime memory), not model weights |
| **MoE (Mixture of Experts)** | Architecture where only a fraction of the model activates per token. 30B model that uses 3B of compute = fast + smart |
| **llama.cpp** | The C++ engine that runs GGUF models. The foundation everything else (Ollama, LM Studio) builds on |
| **Ollama** | User-friendly wrapper around llama.cpp. One-command model download and serving |
| **VRAM** | GPU memory. The bottleneck for local LLM inference — model must fit here for good speed |
| **Tokens/second** | Speed metric. 30+ tok/s = usable for interactive chat. 80+ = comfortable. Below 10 = painful |
| **LiteLLM** | Middleware that lets you swap between any LLM provider (cloud or local) with one line of config |
