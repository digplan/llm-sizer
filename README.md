# llm-sizer

Benchmark your system's memory bandwidth, disk speed, and LLM inference throughput to find the optimal model size for your machine. Supports macOS (Apple Silicon via MLX) and Linux (via PyTorch/Transformers).

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
- **Model Discovery**: Scans local caches (`~/.cache/huggingface/hub`, `/tmp/llm-models`, `/tmp/mlx-models`, etc.) and fetches popular community models from Hugging Face within your machine's memory budget.
- **On-Demand Downloads**: Automatically downloads selected models from Hugging Face Hub if they aren't already cached locally.
- **Inference Benchmarking**: Measures Time To First Token (TTFT), generation speed (Tokens/sec), and total tokens using `mlx-lm` on macOS or `transformers` on Linux.
- **Interactive Speed Demo**: Offers a live 4-second token streaming demonstration in your terminal rendered at the exact speed measured.
- **Iterative Sizing**: Once a benchmark completes, optionally steps down by half to compare performance across model sizes.

## Requirements

- **macOS** with Apple Silicon (uses `mlx-lm`) or **Linux** (uses `transformers` and `torch`)
- **Node.js** (>= 18) or **Bun**
- **Python 3** (required packages are automatically prompted for installation if missing)
- *Note: Windows is not supported.*

## License

MIT
