# Local LLM Hardware Builds — Budget vs Optimal

> Generated: 2026-03-26 | Context: AGENTIC_EXPANSION_V2.md hardware planning

---

## Your Requirements (Translated to Specs)

From your V2 architecture, your machine needs to simultaneously run:
- **3 Docker agent containers** (~512MB each = ~1.5GB)
- **Ollama** serving a quantized model (VRAM for model + ~2-4GB system RAM overhead)
- **PostgreSQL connections** (lightweight, ~0.5GB)
- **OS + headroom** (~4GB)

Total non-GPU RAM usage: ~8-10GB. Everything else is headroom for model offload.

---

## Option 1: The Minimum Viable Build (~$1,050)

**Goal:** Run 7-14B quantized models at usable speed alongside your Docker agents. Nothing fancy, just "it works."

### The Build: Mini-ITX SFF Desktop

| Component | Pick | Price |
|-----------|------|-------|
| CPU | AMD Ryzen 5 7600 (6-core, 65W) | ~$140 |
| Motherboard | ASRock B650I Lightning WiFi (Mini-ITX) | ~$160 |
| RAM | 64GB DDR5-5200 (2x32GB) | ~$120 |
| GPU | RTX 4060 Ti 16GB (used) | ~$300-320 |
| Storage | WD Blue SN580 1TB NVMe | ~$60 |
| Case | Cooler Master NR200P (18.5L, fits full GPUs) | ~$80 |
| PSU | Corsair SF750 SFX (750W, Gold) | ~$120 |
| CPU Cooler | Noctua NH-L9a-AM5 (low-profile, near-silent) | ~$55 |
| **Total** | | **~$1,055** |

### What This Gets You

| Model size | Fits in 16GB VRAM? | Speed |
|-----------|-------------------|-------|
| 7-8B Q4 (Mistral 7B, Gemma 9B) | Yes, with room to spare | ~35-50 tok/s |
| 13-14B Q4 (Qwen2.5-Coder-14B) | Yes, cleanly | ~40-45 tok/s |
| 30B MoE Q4 (Qwen3-30B-A3B, only 3B activated) | Yes (MoE trick) | ~35-45 tok/s |
| 30B dense Q4 | No — spills to RAM, slow | ~10-15 tok/s |
| 70B Q4 | No — way too big | Not viable |

### Why These Specific Parts

**Why RTX 4060 Ti 16GB over RTX 3060 12GB:** The extra 4GB VRAM is the difference between running 14B models comfortably or constantly juggling. For $80-100 more, it's worth it. The 3060 12GB ($220-250 used) saves money but you'll feel the ceiling within months.

**Why 64GB RAM:** Your Docker containers + Ollama overhead + OS eats ~10GB. If a model partially spills to system RAM, you need headroom. 32GB is technically possible but leaves no slack. 64GB DDR5 is only ~$120 — don't skimp here.

**Why Mini-ITX:** About the size of a large shoebox (18.5L). Fits a full-size GPU in a proper PCIe x16 slot. Sits on a desk without dominating it. The NR200P is the most popular SFF case — thousands of documented builds, mesh panels, quiet at idle.

**Why Ryzen 5 7600:** CPU barely matters for GPU inference. Once the model loads on the GPU, the CPU is mostly idle. 6 cores handles Docker + Ollama + OS easily. No need to spend $500+ on a CPU.

**Why not a Mini PC + eGPU:** Investigated this path. The Minisforum UM890 Pro + OCuLink dock + GPU is viable but messy — open-air GPU dock, separate PSU brick, three boxes on your desk. Total cost ends up similar (~$1,050-1,350) with more cables and 5-10% performance penalty. Not worth it unless portability matters.

**Why not a pre-built:** Dell OptiPlex/HP EliteDesk compact desktops often have PCIe x4 slots (not x16), which tanks GPU throughput by 30-40%. Gaming pre-builts overcharge for RGB and gaming CPUs you don't need. Building Mini-ITX is like assembling IKEA furniture — guides everywhere.

### What This Doesn't Do

- No 70B models (need 40GB+ VRAM)
- No 30B dense models at full speed (16GB isn't enough)
- Won't handle future 100B+ models
- Not silent under GPU load (quiet, but the GPU fans spin)

### Verdict

**This is your "get started and prove the concept" machine.** It runs the models your agents would realistically use (7-14B, plus MoE 30B models like Qwen3-30B-A3B), handles Docker Compose comfortably, and costs about the same as a decent monitor. If local LLMs work for your workflow, you upgrade the GPU later — the rest of the build transfers.

---

## Option 2: The Optimal Build

Here you have three genuinely different paths. They cost roughly the same ($3,500-4,000) but make very different tradeoffs.

---

### Option 2A: PC with RTX 4090 (~$3,850)

**The power play.** Best raw speed for models up to 30B. Can attempt 70B with offloading (slow but works).

| Component | Pick | Price |
|-----------|------|-------|
| GPU | ASUS TUF Gaming RTX 4090 OC (24GB) | ~$1,750 |
| CPU | AMD Ryzen 9 9950X (16-core) | ~$580 |
| Motherboard | ASUS ProArt X870E | ~$350 |
| RAM | 128GB DDR5-6000 (4x32GB) | ~$300 |
| Boot SSD | Samsung 990 Pro 1TB | ~$90 |
| Model SSD | WD SN850X 4TB | ~$300 |
| PSU | Seasonic Prime TX-1000 (1000W) | ~$220 |
| Case | be quiet! Silent Base 802 | ~$160 |
| CPU Cooler | Noctua NH-D15S | ~$100 |
| **Total** | | **~$3,850** |

**Performance:**

| Model | Fits in 24GB VRAM? | Speed |
|-------|-------------------|-------|
| 7-8B Q4 | Yes | ~120-150 tok/s |
| 13-14B Q4 | Yes | ~80-100 tok/s |
| 30B Q4 | Yes | ~20-30 tok/s |
| 70B Q4 (~40GB) | No — offloads 16GB to system RAM | ~7-9 tok/s |

**Pros:**
- Fastest option for models that fit in 24GB (everything up to 30B)
- 1,008 GB/s memory bandwidth — nothing consumer-grade beats this
- Upgradeable — swap GPU in 2-3 years to whatever exists
- Linux native, no virtualization overhead for Docker
- 128GB system RAM means even 70B offloading works (slowly)
- 5TB storage holds dozens of model files

**Cons:**
- **Loud under sustained load.** The 4090 is a 450W card. Under inference load the fans spin up. Mitigatable with undervolting (drop to ~350W, minimal performance loss, much quieter) and choosing a good aftermarket cooler card (TUF, WindForce — not Founders Edition)
- 70B is the ceiling, and it's compromised (~7-9 tok/s with offloading)
- Draws ~600-700W at peak — significant electricity for a desk machine
- Mid-tower case (Silent Base 802) is larger than the NR200P

---

### Option 2B: PC with Used A6000 Ada (~$5,500)

**The 70B specialist.** Same PC platform, swap the 4090 for a professional GPU with 48GB VRAM.

Same build as 2A but replace GPU:
- **RTX A6000 Ada (48GB GDDR6)**: ~$3,200-3,500 used
- **Total build**: ~$5,300-5,500

**Performance:**

| Model | Fits in 48GB VRAM? | Speed |
|-------|-------------------|-------|
| 7-8B Q4 | Yes | ~80-100 tok/s |
| 13-14B Q4 | Yes | ~60-80 tok/s |
| 30B Q4 | Yes | ~35-45 tok/s |
| 70B Q4 (~40GB) | **Yes — fully in VRAM** | **~18-25 tok/s** |

**The tradeoff:** The A6000 Ada has lower bandwidth (768 GB/s vs 4090's 1,008 GB/s), so for models under 30B the 4090 is actually faster. Where the A6000 wins is the 70B case — no offloading penalty means 2-3x the speed of a 4090 on 70B.

**Verdict:** Only worth it if you specifically need 70B to run clean. At $1,500-1,750 more than the 4090 build, you're paying a premium for 24GB of extra VRAM. Skip unless 70B is a firm requirement.

---

### Option 2C: Mac Studio M4 Max 128GB (~$3,999)

**The plot twist.** Apple's unified memory architecture changes the math entirely.

| Spec | Value |
|------|-------|
| Chip | Apple M4 Max |
| Memory | 128GB unified (shared CPU + GPU) |
| Storage | 1TB SSD (configurable) |
| Memory bandwidth | 546 GB/s |
| Power draw | ~60-80W under LLM load |
| Noise | Near-silent |
| Size | 6.7" x 6.7" x 3.7" |
| Price | ~$3,999 |

**Performance:**

| Model | Fits in 128GB unified memory? | Speed |
|-------|-------------------------------|-------|
| 7-8B Q4 | Yes | ~50-70 tok/s |
| 13-14B Q4 | Yes | ~40-60 tok/s |
| 30B Q4 | Yes | ~25-35 tok/s |
| 70B Q4 (~40GB) | **Yes — no offloading** | **~10-18 tok/s** |
| 100B+ Q4 | Possible | ~5-10 tok/s |

**Why this is interesting:**

The M4 Max has "unified memory" — system RAM and GPU memory are the same pool. There's no separate VRAM. The entire 128GB is available for model inference. This means:
- 70B Q4 fits entirely in memory with 88GB to spare
- No offloading penalty — every layer is accessed at full bandwidth
- You could even run 70B at Q8 (near-lossless quality, ~70GB) with room left

**Pros:**
- **Near-silent.** No GPU fans. Barely audible intake fan. This is genuinely quiet.
- **70B runs clean** with no offloading, at similar speed to the A6000 build that costs $1,500 more
- **Complete system for $3,999** — no assembly, no driver debugging, no PSU sizing
- **60-80W total power** vs 600-700W for the PC builds
- **Tiny footprint** — sits under a monitor
- Ollama has first-class Apple Silicon support via Metal
- Docker Desktop works on macOS (ARM64 containers run near-native speed)

**Cons:**
- **Slower on small models** than the 4090. If you're mostly running 7-14B, the PC builds are faster.
- **Not upgradeable.** Memory is soldered. GPU is the chip. What you buy is what you have for the life of the machine.
- **Docker runs through macOS virtualization** — works fine, but not bare-metal Linux. Slight overhead.
- **Your current workflow is WSL2/Ubuntu.** You'd adapt to macOS. Not a rebuild, but different. Docker Compose, Node.js, SSH all work fine. The dev environment adapts in an afternoon.
- **No CUDA.** If you ever want to fine-tune models (not just inference), Apple's MPS works but isn't as mature as NVIDIA's CUDA ecosystem.

---

## The Comparison Table

| | **Option 1: Budget** | **Option 2A: RTX 4090** | **Option 2B: A6000 Ada** | **Option 2C: Mac Studio** |
|---|---|---|---|---|
| **Cost** | ~$1,055 | ~$3,850 | ~$5,500 | ~$3,999 |
| **GPU Memory** | 16GB | 24GB | 48GB | 128GB unified |
| **7B speed** | ~35-50 tok/s | ~120-150 tok/s | ~80-100 tok/s | ~50-70 tok/s |
| **14B speed** | ~40-45 tok/s | ~80-100 tok/s | ~60-80 tok/s | ~40-60 tok/s |
| **30B speed** | ~10-15 tok/s (offload) | ~20-30 tok/s | ~35-45 tok/s | ~25-35 tok/s |
| **70B viable?** | No | Slow (~7-9 tok/s) | Yes (~18-25 tok/s) | Yes (~10-18 tok/s) |
| **Docker** | Linux native | Linux native | Linux native | macOS virtualization |
| **Noise** | Quiet | Loud under load | Loud under load | Near-silent |
| **Power draw** | ~250W peak | ~700W peak | ~650W peak | ~80W peak |
| **Upgradeable** | Yes (GPU swap) | Yes (GPU swap) | Yes (GPU swap) | No |
| **Size** | Shoebox (18.5L) | Mid-tower | Mid-tower | 6.7" cube |
| **Future-proof** | 1-2 years | 2-3 years | 3-4 years | 3-4 years |

---

## What About the RTX 5090?

**Skip it right now.** MSRP is $1,999 but street price is $2,900-3,500+ due to supply shortages. For that money you get 32GB VRAM — only 8GB more than the 4090's 24GB. 70B still doesn't fit fully. The bandwidth is better (1,792 GB/s vs 1,008 GB/s), so small-model speed is ~67% faster. But at nearly double the cost of a 4090 for the same 70B limitation, the value isn't there in March 2026. Revisit when it drops to MSRP.

---

## My Recommendation

**Start with Option 1 (~$1,055).** Here's why:

1. **Your V1 agents use cloud APIs anyway.** AGENTIC_EXPANSION_V2 is designed for NVIDIA API / DeepSeek. Local LLM is a "nice to have" for V1, not a requirement.

2. **Option 1 proves the concept.** A 14B quantized model running locally alongside your Docker agents tells you whether local inference actually works for your use case before you spend $4,000.

3. **The GPU is the only part that matters for upgrading.** If Option 1 works and you want more power, sell the RTX 4060 Ti and buy a 4090. The CPU, RAM, motherboard, case, PSU all stay. You'd need a bigger case (NR200P fits a 4090 but it's tight — you might swap to the Silent Base 802), but the core platform transfers.

4. **$1,055 is low-risk.** If local LLMs don't work for your agents, you still have a solid Linux server for Docker, dev work, or anything else. $4,000 is a bigger bet on something unproven in your workflow.

**If money isn't the primary concern and you want to go straight to optimal:** the Mac Studio M4 Max 128GB ($3,999) is the most compelling option. Silent, compact, handles 70B cleanly, zero assembly, and the unified memory architecture is a genuine advantage for LLM inference that PC builds can't match without spending $5,500+ on an A6000. The tradeoff is no upgradeability and slightly slower on small models vs a 4090.

---

## GPU Quick-Reference: What NOT to Buy

| GPU | Why not |
|-----|---------|
| RTX 5090 at current prices | $3,000+ for 32GB — still can't fit 70B, terrible value |
| RTX 5080 | 16GB VRAM — less than a 4090 for LLM work |
| RTX 4060 (8GB) | 8GB is too small for anything beyond 7B |
| RTX 3060 Ti (8GB) | Same — 8GB is the floor, not useful |
| Any "gaming" pre-built | Overpay for RGB and gaming CPU you don't need |
| RTX PRO 6000 (96GB) | $8,500+ — data center pricing, overkill |
