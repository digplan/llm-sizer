#!/usr/bin/env node
import { execSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { open, readFile, readdir, rm, stat, statfs, unlink } from "node:fs/promises";
import { cpus, homedir, totalmem } from "node:os";
import { dirname } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";

if (process.platform === "win32") {
	console.log("Not supported in Windows");
	process.exit(1);
}

if (!isMainThread) {
	const source = new Uint8Array(workerData.bytes), target = new Uint8Array(source.length);
	parentPort.on("message", ({ copies }) => {
		const start = performance.now();
		for (let i = 0; i < copies; i++) target.set(source);
		parentPort.postMessage(target.length * copies / ((performance.now() - start) / 1000) / 1e9);
	});
	parentPort.postMessage("ready");
} else {
const isMac = process.platform === "darwin";
const isLinux = process.platform === "linux";
const rl = createInterface({ input: process.stdin, output: process.stdout });
const ask = q => new Promise(res => {
	if (rl.closed) return res("");
	rl.question(q, res);
	rl.once("close", () => res(""));
});
const sleep = ms => new Promise(r => setTimeout(r, ms));
const which = cmd => {
	try { return execSync(`which ${cmd} 2>/dev/null`, { encoding: "utf8" }).trim(); } catch { return null; }
};
const spawnProc = (cmd, args, { env = process.env, stdio = "inherit", capture = false } = {}) => {
	const cp = spawn(cmd, args, { env, stdio: capture ? ["inherit", "pipe", "inherit"] : stdio });
	let stdout = "";
	if (capture && cp.stdout) cp.stdout.on("data", d => { stdout += d; });
	return { exited: new Promise(res => cp.on("close", res)), kill: sig => cp.kill(sig), getOutput: () => stdout };
};

const venvDir = process.env.VIRTUAL_ENV || "/tmp/llm-sizer-venv";
const venvPython = `${venvDir}/bin/python`;
const systemPython = which("python3") || which("python");

let python = existsSync(venvPython) ? venvPython : null;
if (python) {
	process.env.VIRTUAL_ENV = venvDir;
	process.env.PATH = `${venvDir}/bin:${process.env.PATH}`;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectBinDir = `${__dirname}/bin`;
const projectLibDir = `${__dirname}/lib/ollama`;
process.env.OLLAMA_MODELS = process.env.OLLAMA_MODELS || `${__dirname}/.ollama/models`;
let ollamaBin = existsSync(`${projectBinDir}/ollama`) ? `${projectBinDir}/ollama` : which("ollama");

const backendName = isMac ? "mlx-lm" : "Ollama";
let backendInstalled = false;

const isOllamaRunning = async () => {
	try {
		const res = await fetch("http://127.0.0.1:11434/api/tags", { signal: AbortSignal.timeout(1000) });
		return res.ok;
	} catch {
		return false;
	}
};

let ollamaProc = null;
const ensureOllamaRunning = async () => {
	if (await isOllamaRunning()) return true;
	if (!ollamaBin) return false;
	ollamaProc = spawn(ollamaBin, ["serve"], {
		env: { ...process.env, OLLAMA_MODELS: process.env.OLLAMA_MODELS },
		stdio: "ignore",
		detached: true
	});
	ollamaProc.unref();
	for (let i = 0; i < 20; i++) {
		await sleep(250);
		if (await isOllamaRunning()) return true;
	}
	return false;
};

process.on("exit", () => {
	if (ollamaProc) {
		try { ollamaProc.kill(); } catch {}
	}
});

if (isMac) {
	if (python) {
		backendInstalled = (await spawnProc(python, ["-c", "import mlx_lm"], { stdio: "ignore" }).exited) === 0;
	}
	const hasPython = Boolean(python || systemPython);
	if (!backendInstalled && hasPython && /^y(es)?$/i.test(await ask(`mlx-lm is not installed. Install mlx-lm in virtual environment (${venvDir})? [y/N] `) ?? "")) {
		if (!python) {
			console.log(`\nCreating virtual environment in ${venvDir}...`);
			let venvCreated = (await spawnProc(systemPython, ["-m", "venv", venvDir], { stdio: "inherit" }).exited) === 0;
			if (!venvCreated) venvCreated = (await spawnProc(systemPython, ["-m", "venv", "--without-pip", venvDir], { stdio: "inherit" }).exited) === 0;
			if (venvCreated && existsSync(venvPython)) {
				python = venvPython;
				process.env.VIRTUAL_ENV = venvDir;
				process.env.PATH = `${venvDir}/bin:${process.env.PATH}`;
			}
		}
		if (python) {
			let hasPip = (await spawnProc(python, ["-m", "pip", "--version"], { stdio: "ignore" }).exited) === 0;
			if (!hasPip) {
				await spawnProc(python, ["-m", "ensurepip", "--default-pip"], { stdio: "ignore" }).exited;
				hasPip = (await spawnProc(python, ["-m", "pip", "--version"], { stdio: "ignore" }).exited) === 0;
			}
			if (!hasPip) {
				try {
					const res = await fetch("https://bootstrap.pypa.io/get-pip.py", { signal: AbortSignal.timeout(15000) });
					if (res.ok) {
						const script = await res.text();
						const getPipProc = spawn(python, ["-"], { stdio: ["pipe", "inherit", "inherit"] });
						getPipProc.stdin.end(script);
						await new Promise(r => getPipProc.on("close", r));
						hasPip = (await spawnProc(python, ["-m", "pip", "--version"], { stdio: "ignore" }).exited) === 0;
					}
				} catch {}
			}
			if (hasPip) {
				const install = spawnProc(python, ["-m", "pip", "install", "mlx-lm"]);
				if ((await install.exited) === 0) {
					backendInstalled = (await spawnProc(python, ["-c", "import mlx_lm"], { stdio: "ignore" }).exited) === 0;
				}
			}
		}
	}
} else {
	if (ollamaBin) {
		backendInstalled = (await spawnProc(ollamaBin, ["--version"], { stdio: "ignore" }).exited) === 0;
	}
	if (!backendInstalled && /^y(es)?$/i.test(await ask("Ollama is not installed. Download and install Ollama? [y/N] ") ?? "")) {
		console.log("\nInstalling Ollama...");
		try {
			if (!which("zstd") || !which("curl")) {
				if (which("apt-get")) execSync("apt-get update -qq && apt-get install -y -qq zstd curl", { stdio: "inherit" });
				else if (which("dnf")) execSync("dnf install -y -q zstd curl", { stdio: "inherit" });
				else if (which("pacman")) execSync("pacman -Sy --noconfirm zstd curl", { stdio: "inherit" });
				else if (which("apk")) execSync("apk add --no-cache zstd curl", { stdio: "inherit" });
			}
			execSync("curl -fsSL https://ollama.com/install.sh | sh", { stdio: "inherit" });
			const sysOllama = which("ollama");
			if (sysOllama) {
				execSync(`mkdir -p "${projectBinDir}" "${projectLibDir}"`);
				execSync(`cp "${sysOllama}" "${projectBinDir}/"`);
				if (existsSync("/usr/local/lib/ollama")) {
					execSync(`cp -a /usr/local/lib/ollama/* "${projectLibDir}/"`);
				}
				ollamaBin = `${projectBinDir}/ollama`;
				backendInstalled = true;
			}
		} catch (err) {
			console.error("Failed to install Ollama:", err.message);
		}
	}
	if (backendInstalled) {
		await ensureOllamaRunning();
	}
}

const source = new Uint8Array(256 * 1024 ** 2), target = new Uint8Array(source.length);
target.set(source);
let bandwidth = 0;
for (let run = 0; run < 5; run++) {
	const start = performance.now();
	for (let i = 0; i < 4; i++) target.set(source);
	bandwidth += source.byteLength * 4 / ((performance.now() - start) / 1000) / 1e9;
}
bandwidth /= 5;

const storageFile = `/tmp/bun-storage-${process.pid}.bin`, storageData = new Uint8Array(64 * 1024 ** 2);
storageData.fill(0xa5);
let storage = 0;
try {
	const file = await open(storageFile, "w");
	try {
		for (let run = 0; run < 5; run++) {
			const start = performance.now();
			await file.write(storageData, 0, storageData.length, 0);
			await file.sync();
			storage += storageData.length / ((performance.now() - start) / 1000) / 1e9;
		}
	} finally { await file.close(); }
} finally { await unlink(storageFile).catch(() => {}); }
storage /= 5;

let multiBandwidth = 0;
const workers = Array.from({ length: cpus().length }, () => new Worker(new URL(import.meta.url), {
	workerData: { bytes: 32 * 1024 ** 2 }
}));
try {
	await Promise.all(workers.map(w => new Promise((res, rej) => { w.once("message", res); w.once("error", rej); })));
	for (let run = 0; run < 5; run++) {
		const start = performance.now();
		await Promise.all(workers.map(w => new Promise((res, rej) => {
			w.once("message", res);
			w.once("error", rej);
			w.postMessage({ copies: 4 });
		})));
		multiBandwidth += cpus().length * 32 * 1024 ** 2 * 4 / ((performance.now() - start) / 1000) / 1e9;
	}
	multiBandwidth /= 5;
} finally {
	await Promise.all(workers.map(w => w.terminate()));
}

let gpuInfo = "";
let gpuMem = 0;
if (!isMac && python) {
	try {
		const out = execSync(`${python} -c "import torch; print(f'{torch.cuda.get_device_name(0)}|{torch.cuda.get_device_properties(0).total_memory}') if torch.cuda.is_available() else print('')" 2>/dev/null`, { encoding: "utf8" }).trim();
		if (out) {
			const [name, mem] = out.split("|");
			gpuMem = Number(mem) || 0;
			gpuInfo = ` | GPU: ${name} (${(gpuMem / 1024 ** 3).toFixed(2)} GB VRAM)`;
		}
	} catch {}
}

console.log("\n========== SYSTEM PERFORMANCE ==========");
console.log(`CPU: ${cpus()[0]?.model ?? "Unknown"} | RAM: ${(totalmem() / 1024 ** 3).toFixed(2)} GB${gpuInfo} | Mem: ${bandwidth.toFixed(2)} GB/s | Mem MT: ${multiBandwidth.toFixed(2)} GB/s | Disk: ${storage.toFixed(2)} GB/s`);
console.log("========================================");
if (isMac) console.log(`${hasPython ? "✅" : "❌"} Python installed`);
console.log(`${backendInstalled ? "✅" : "❌"} ${backendName} installed`);

if (!backendInstalled || (isMac && !python)) {
	console.error(`\n${backendName} is required to run model benchmarks.`);
	rl.close();
	process.exit(1);
}

const anyExcluded = name => {
	if (!name) return false;
	const str = String(name).toLowerCase();
	return /-vl\b|-vision\b|whisper|embedding|rerank|\blfm\b|liquid|\bqwen3\b/i.test(str);
};

const isCompatibleModel = (name, metadata = {}) => {
	const lowerName = name.toLowerCase();
	const lowerDir = (metadata.directory ?? "").toLowerCase();
	if (anyExcluded(lowerName) || anyExcluded(lowerDir)) return false;

	const tags = (metadata.tags ?? []).map(t => String(t).toLowerCase());
	const lib = String(metadata.library_name ?? "").toLowerCase();
	const config = metadata.config ?? null;

	const hasMlxConfig = config && (
		config.quantization != null ||
		config.model_file != null ||
		(typeof config.model_type === "string" && config.model_type.toLowerCase().includes("mlx"))
	);

	const isMlx = lowerName.startsWith("mlx-community/") ||
		/(?:^|[-_./])mlx(?:[-_./]|$)/i.test(name) ||
		lowerDir.includes("mlx") ||
		lib === "mlx" ||
		tags.includes("mlx") ||
		Boolean(hasMlxConfig);

	const isGguf = /(?:^|[-_./])gguf(?:[-_./]|$)/i.test(name) ||
		lowerDir.includes("gguf") ||
		lowerName.endsWith(".gguf") ||
		lib === "gguf" ||
		tags.includes("gguf");

	if (isMac) return isMlx && !isGguf;
	return isGguf;
};

const modelSize = (name, metadata) => {
	if (!isCompatibleModel(name, metadata)) return 0;
	const p = name.match(/(\d+(?:\.\d+)?)\s*([bm])(?:-|$)/i);
	const b = name.match(/(?:-|\b)(\d+)-?bit/i);
	if (!p) return 0;
	const params = Number(p[1]) * (p[2].toUpperCase() === "B" ? 1e9 : 1e6);
	const bits = b ? Number(b[1]) : (isMac ? 16 : 4);
	return params * (bits / 8) * 1.1;
};
const sizeText = bytes => bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${(bytes / 1e6).toFixed(0)} MB`;
const confirmDiskSpace = async (directory, requiredBytes) => {
	const { bavail, bsize } = await statfs(directory);
	const availableBytes = bavail * bsize;
	if (availableBytes >= requiredBytes) return true;
	console.error(`Not enough disk space for ${sizeText(requiredBytes)} download: ${sizeText(availableBytes)} available in ${directory}.`);
	return /^y(es)?$/i.test(await ask("Free some disk space, or continue anyway? [y/N] ") ?? "");
};

const localModels = [];
const modelDownloadDir = isMac ? "/tmp/mlx-models" : "/tmp/llm-models";
const roots = [
	modelDownloadDir,
	`${homedir()}/.cache/huggingface/hub`,
	`${homedir()}/models`,
	`${homedir()}/Models`
];
const scan = async (directory, depth = 0) => {
	if (depth > 4 || /whisper/i.test(directory)) return;
	let entries;
	try { entries = await readdir(directory, { withFileTypes: true }); } catch { return; }

	if (isMac) {
		const weights = entries.filter(e => /\.(safetensors|npz)$/i.test(e.name));
		if (entries.some(e => e.name === "config.json") && weights.length) {
			let bytes = 0;
			for (const w of weights) {
				try { bytes += (await stat(`${directory}/${w.name}`)).size; } catch {}
			}
			let config = null;
			try {
				const configRaw = await readFile(`${directory}/config.json`, "utf8");
				config = JSON.parse(configRaw);
			} catch {}
			const hubMatch = directory.match(/models--([^/]+)/);
			const name = hubMatch ? hubMatch[1].replaceAll("--", "/") : directory.split("/").pop().replaceAll("--", "/");
			if (isCompatibleModel(name, { directory, config, isLocal: true }) && !localModels.some(m => m.name === name)) {
				localModels.push({ name, path: directory, bytes, local: true });
			}
			return;
		}
		for (const e of entries.filter(e => e.isDirectory())) await scan(`${directory}/${e.name}`, depth + 1);
	}
};
for (const root of roots) await scan(root);

if (!isMac) {
	try {
		const res = await fetch("http://127.0.0.1:11434/api/tags", { signal: AbortSignal.timeout(3000) });
		if (res.ok) {
			const data = await res.json();
			for (const m of (data.models ?? [])) {
				if (!localModels.some(c => c.name === m.name)) {
					localModels.push({ name: m.name, bytes: m.size, local: true });
				}
			}
		}
	} catch {}
}

const budget = (gpuMem > 0 ? gpuMem : totalmem()) * 0.65;
const candidates = localModels.filter(m => m.bytes <= budget);

if (isMac) {
	const hfApiUrl = "https://huggingface.co/api/models?author=mlx-community&search=Instruct&sort=downloads&direction=-1&limit=100";
	try {
		const response = await fetch(hfApiUrl, { signal: AbortSignal.timeout(8000) });
		if (response.ok) {
			for (const model of await response.json()) {
				const bytes = modelSize(model.id, model);
				if (bytes && bytes <= budget && !candidates.some(c => c.name === model.id)) candidates.push({ name: model.id, bytes });
			}
		}
	} catch {}
} else {
	const OLLAMA_CATALOG = [
		{ name: "smollm2:135m", bytes: 270 * 1024 ** 2 },
		{ name: "qwen2.5:0.5b", bytes: 397 * 1024 ** 2 },
		{ name: "smollm2:360m", bytes: 450 * 1024 ** 2 },
		{ name: "smollm2:1.7b", bytes: 1.0 * 1024 ** 3 },
		{ name: "qwen2.5:1.5b", bytes: 986 * 1024 ** 2 },
		{ name: "deepseek-r1:1.5b", bytes: 1.1 * 1024 ** 3 },
		{ name: "llama3.2:1b", bytes: 1.3 * 1024 ** 3 },
		{ name: "gemma2:2b", bytes: 1.6 * 1024 ** 3 },
		{ name: "qwen2.5:3b", bytes: 1.9 * 1024 ** 3 },
		{ name: "llama3.2:3b", bytes: 2.0 * 1024 ** 3 },
		{ name: "phi3.5:3.8b", bytes: 2.2 * 1024 ** 3 },
		{ name: "mistral:7b", bytes: 4.1 * 1024 ** 3 },
		{ name: "qwen2.5:7b", bytes: 4.7 * 1024 ** 3 },
		{ name: "llama3.1:8b", bytes: 4.9 * 1024 ** 3 },
		{ name: "gemma2:9b", bytes: 5.5 * 1024 ** 3 },
		{ name: "phi4:14b", bytes: 9.1 * 1024 ** 3 },
		{ name: "qwen2.5:14b", bytes: 9.0 * 1024 ** 3 },
		{ name: "deepseek-r1:14b", bytes: 9.0 * 1024 ** 3 },
		{ name: "qwen2.5:32b", bytes: 20.0 * 1024 ** 3 },
		{ name: "llama3.3:70b", bytes: 43.0 * 1024 ** 3 }
	];
	for (const m of OLLAMA_CATALOG) {
		if (m.bytes <= budget && !candidates.some(c => c.name === m.name)) {
			candidates.push(m);
		}
	}
}

let pool;
for (;;) {
	const choices = (pool ?? candidates).sort((a, b) => b.bytes - a.bytes).slice(0, 4);
	if (!choices.length) break;
	console.log("\n========== MODEL SELECTION ==========");
	choices.forEach((m, i) => console.log(`${i + 1}. ${m.name} (${sizeText(m.bytes)}${m.local ? ", local" : ""})`));
	console.log("=====================================");
	const selected = Number(await ask("Choose a model to use, or press Enter to skip: ")) - 1;
	const model = choices[selected];
	if (!model) break;

	let selectedModel = model.name;
	if (!model.local) {
		if (isMac) {
			if (await confirmDiskSpace("/tmp", model.bytes * 1.1)) {
				const modelPath = `${modelDownloadDir}/${model.name.replaceAll("/", "--")}`;
				const folderSize = async dir => {
					let bytes = 0;
					const walk = async p => {
						let list;
						try { list = await readdir(p, { withFileTypes: true }); } catch { return; }
						for (const item of list) {
							const sub = `${p}/${item.name}`;
							if (item.isDirectory()) await walk(sub);
							else try { bytes += (await stat(sub)).size; } catch {}
						}
					};
					await walk(dir);
					return bytes;
				};
				const token = process.env.HF_TOKEN ?? process.env.HF_API_KEY ?? process.env.HUGGINGFACE_API_KEY ?? process.env.HUGGING_FACE_HUB_TOKEN ?? ((await ask("No HF token in env. Enter a Hugging Face token, or press Enter to continue anonymously: ") ?? "") || undefined);
				const downloadPy = "from huggingface_hub import snapshot_download; snapshot_download(repo_id=__import__('os').environ['MODEL_ID'], local_dir=__import__('os').environ['MODEL_DIR'])";
				const download = spawnProc(python, ["-c", downloadPy], {
					env: { ...process.env, MODEL_ID: model.name, MODEL_DIR: modelPath, ...(token ? { HF_TOKEN: token, HUGGING_FACE_HUB_TOKEN: token } : {}) },
					stdio: ["ignore", "ignore", "inherit"]
				});
				process.stdout.write(`Downloading ${model.name}...`);
				const progress = setInterval(async () => process.stdout.write(`\rDownloading ${model.name}: ${sizeText(await folderSize(modelPath))}`), 1000);
				const onSigint = async () => { clearInterval(progress); download.kill("SIGINT"); await rm(modelPath, { recursive: true, force: true }); process.exit(130); };
				process.on("SIGINT", onSigint);
				const exitCode = await download.exited;
				process.off("SIGINT", onSigint);
				clearInterval(progress);
				process.stdout.write(`\r${exitCode === 0 ? "Downloaded" : "Download failed"}: ${model.name}\n`);
				if (exitCode === 0) {
					selectedModel = modelPath;
					console.log(`Model path: ${modelPath}`);
				} else {
					await rm(modelPath, { recursive: true, force: true });
					selectedModel = null;
				}
			} else {
				console.log("Download skipped.");
				selectedModel = null;
			}
		} else {
			console.log(`\nPulling ${model.name} (${sizeText(model.bytes)})...`);
			const pullProc = spawnProc(ollamaBin, ["pull", model.name], {
				env: { ...process.env, OLLAMA_MODELS: process.env.OLLAMA_MODELS },
				stdio: "inherit"
			});
			const onSigint = () => { pullProc.kill("SIGINT"); process.exit(130); };
			process.on("SIGINT", onSigint);
			const exitCode = await pullProc.exited;
			process.off("SIGINT", onSigint);
			if (exitCode !== 0) {
				console.error("\nFailed to pull model with Ollama.");
				selectedModel = null;
			}
		}
	} else if (isMac) {
		selectedModel = model.path;
	}
	if (!selectedModel) break;

	const engineName = isMac ? "MLX" : "Ollama";
	console.log(`\nRunning ${engineName} benchmark for ${model.name}...`);

	const prompts = [
		"Explain what RAM does in about 50 words.",
		"Explain why the sky appears blue in about 50 words.",
		"Give a simple three-step recipe for making tea.",
		"Explain the difference between a CPU and a GPU in about 50 words.",
		"Describe the water cycle in about 50 words."
	];

	const results = [];

	if (isMac) {
		const benchmark = `
import json, os, time
from mlx_lm import load, stream_generate

model, tokenizer = load(os.environ["MODEL_PATH"])
prompts = [
    "Explain what RAM does in about 50 words.",
    "Explain why the sky appears blue in about 50 words.",
    "Give a simple three-step recipe for making tea.",
    "Explain the difference between a CPU and a GPU in about 50 words.",
    "Describe the water cycle in about 50 words."
]
for prompt in prompts:
    start = time.perf_counter()
    first, last_resp = None, None
    for response in stream_generate(model, tokenizer, prompt, max_tokens=128):
        if first is None: first = time.perf_counter()
        last_resp = response
    if last_resp and last_resp.generation_tokens:
        ttft = (first - start) if first else 0
        print(json.dumps({"ttft": ttft, "tps": last_resp.generation_tps, "tokens": last_resp.generation_tokens}), flush=True)
`;
		const test = spawnProc(python, ["-c", benchmark], {
			env: { ...process.env, MODEL_PATH: selectedModel },
			capture: true
		});
		if ((await test.exited) === 0) {
			const parsed = test.getOutput().trim().split("\n").map(l => {
				try { return JSON.parse(l.trim()); } catch { return null; }
			}).filter(Boolean);
			results.push(...parsed);
		}
	} else {
		for (const prompt of prompts) {
			try {
				const res = await fetch("http://127.0.0.1:11434/api/generate", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						model: selectedModel,
						prompt,
						stream: false,
						options: {
							num_predict: 128,
							num_ctx: 512
						}
					})
				});
				if (!res.ok) {
					console.error("\n❌ Ollama inference failed:", res.statusText);
					break;
				}
				const data = await res.json();
				const genTps = data.eval_duration > 0 ? (data.eval_count / (data.eval_duration / 1e9)) : 0;
				const ttft = (data.prompt_eval_duration || 0) / 1e9;
				results.push({ ttft, tps: genTps, tokens: data.eval_count || 128 });
			} catch (err) {
				console.error("\n❌ Error during Ollama benchmark:", err.message);
				break;
			}
		}
	}

	if (results.length) {
		const meanTps = results.reduce((s, r) => s + r.tps, 0) / results.length;
		console.log(`\n========== ${engineName.toUpperCase()} TOKEN TEST ==========`);
		results.forEach((r, i) => console.log(`${i + 1}. TTFT: ${(r.ttft * 1000).toFixed(0)} ms | Tok/s: ${r.tps.toFixed(2)} | Tokens: ${r.tokens}`));
		console.log(`Mean TTFT: ${(results.reduce((s, r) => s + r.ttft, 0) / results.length * 1000).toFixed(0)} ms | Mean Tok/s: ${meanTps.toFixed(2)}`);
		console.log("=====================================");
		if (/^y(es)?$/i.test(await ask(`Show how fast ${meanTps.toFixed(1)} tok/s looks like? [y/N] `) ?? "")) {
			const demoText = isMac
				? "Artificial intelligence and large language models process text by predicting the next token in a sequence. With Apple Silicon unified memory architecture, weights are streamed with high bandwidth directly to the GPU cores. "
				: "Artificial intelligence and large language models process text by predicting the next token in a sequence. Weights and activations are streamed with high bandwidth directly to the compute cores for fast token generation. ";
			const words = demoText.repeat(5).match(/\s*\S+/g);
			const demoStart = performance.now();
			for (let i = 0; performance.now() - demoStart < 4000; i++) {
				process.stdout.write(words[i % words.length]);
				await sleep(1000 / meanTps);
			}
			console.log("\n");
		}
	} else {
		console.error(`\nBenchmark of ${model.name} failed.`);
		break;
	}

	const half = candidates.filter(c => c.bytes && c.bytes <= model.bytes / 2);
	const nextPool = half.length ? half : candidates.filter(c => c.bytes && c.bytes > 0 && c.bytes < model.bytes);
	if (!nextPool.length || !/^y(es)?$/i.test(await ask(`\nBenchmark of ${model.name} done. Try a model about half the size? [y/N] `) ?? "")) break;
	pool = nextPool;
}
rl.close();
}
