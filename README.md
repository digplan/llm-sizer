# llm-sizer

Benchmark your system's memory bandwidth, disk speed, and LLM inference throughput to find the optimal model size for your machine. Supports macOS (Apple Silicon via MLX) and Linux (via Ollama).

## Quick Start

Run instantly without installing:

```bash
npx llm-sizer
```

Or with [Bun](https://bun.sh):

```bash
bun llm-sizer.js
```

## Features

- **Hardware Benchmarks**: Measures single-threaded and multi-threaded memory bandwidth (GB/s) along with disk write throughput (and detects GPU/VRAM on Linux).
- **Model Discovery**: Scans local caches and models (`~/.cache/huggingface/hub`, `/tmp/mlx-models`, or local Ollama instances) and provides curated or community models fitting within your machine's memory budget.
- **On-Demand Downloads**: Automatically downloads selected models (via Hugging Face Hub for MLX on macOS, or Ollama pull on Linux).
- **Inference Benchmarking**: Measures Time To First Token (TTFT), generation speed (Tokens/sec), and total tokens using `mlx-lm` on macOS or `ollama` on Linux.
- **Interactive Speed Demo**: Offers a live 4-second token streaming demonstration in your terminal rendered at the exact speed measured.
- **Iterative Sizing**: Once a benchmark completes, optionally steps down by half to compare performance across model sizes.

## Requirements

- **macOS** with Apple Silicon (uses `mlx-lm` and Python 3) or **Linux** (uses `ollama`, automatically downloaded and managed if not present)
- **Node.js** (>= 18) or **Bun**
- *Note: Windows is not supported.*

## License

MIT
