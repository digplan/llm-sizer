# llm-sizer

Benchmark your Apple Silicon Mac's memory bandwidth, disk speed, and MLX LLM inference throughput to find the optimal model size for your machine.

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

- **Hardware Benchmarks**: Measures single-threaded and multi-threaded memory bandwidth (GB/s) along with disk write throughput.
- **Model Discovery**: Scans local caches (`~/.cache/huggingface/hub`, `/tmp/mlx-models`, etc.) and fetches popular community models from `mlx-community` within your machine's unified memory budget.
- **On-Demand Downloads**: Automatically downloads selected models from Hugging Face Hub if they aren't already cached locally.
- **Inference Benchmarking**: Measures Time To First Token (TTFT), generation speed (Tokens/sec), and total tokens using `mlx-lm`.
- **Interactive Speed Demo**: Offers a live 4-second token streaming demonstration in your terminal rendered at the exact speed measured.
- **Iterative Sizing**: Once a benchmark completes, optionally steps down by half to compare performance across model sizes.

## Requirements

- **macOS** with Apple Silicon (M1/M2/M3/M4/M5)
- **Node.js** (>= 18) or **Bun**
- **Python 3** with `mlx-lm` (prompted automatically if missing)

## License

MIT
