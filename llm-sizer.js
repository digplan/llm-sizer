#!/usr/bin/env node
import { execSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { open, readdir, rm, stat, statfs, unlink } from "node:fs/promises";
import { cpus, homedir, totalmem } from "node:os";
import { createInterface } from "node:readline";
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";

if (!isMainThread) {
	const source = new Uint8Array(workerData.bytes), target = new Uint8Array(source.length);
	parentPort.on("message", ({ copies }) => {
		const start = performance.now();
		for (let i = 0; i < copies; i++) target.set(source);
		parentPort.postMessage(target.length * copies / ((performance.now() - start) / 1000) / 1e9);
	});
	parentPort.postMessage("ready");
} else {
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

const pythonCandidates = [
	process.env.VIRTUAL_ENV && `${process.env.VIRTUAL_ENV}/bin/python`,
	which("python3"),
	which("python")
].filter(Boolean);
let python;
for (const candidate of pythonCandidates) {
	if (existsSync(candidate)) { python = candidate; break; }
}
let mlxInstalled = false;
if (python) {
	mlxInstalled = (await spawnProc(python, ["-c", "import mlx_lm"], { stdio: "ignore" }).exited) === 0;
	if (!mlxInstalled && /^y(es)?$/i.test(await ask("mlx-lm is not installed. Install mlx-lm? [y/N] ") ?? "")) {
		const install = spawnProc(python, ["-m", "pip", "install", "--user", "--break-system-packages", "mlx-lm"]);
		if (await install.exited === 0) mlxInstalled = (await spawnProc(python, ["-c", "import mlx_lm"], { stdio: "ignore" }).exited) === 0;
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

console.log("\n========== SYSTEM PERFORMANCE ==========");
console.log(`CPU: ${cpus()[0]?.model ?? "Unknown"} | RAM: ${(totalmem() / 1024 ** 3).toFixed(2)} GB | Mem: ${bandwidth.toFixed(2)} GB/s | Mem MT: ${multiBandwidth.toFixed(2)} GB/s | Disk: ${storage.toFixed(2)} GB/s`);
console.log("========================================");
console.log(`${python ? "✅" : "❌"} Python installed`);
console.log(`${mlxInstalled ? "✅" : "❌"} mlx-lm installed`);

if (!python || !mlxInstalled) {
	console.error("\nPython 3 and mlx-lm are required to run model benchmarks.");
	rl.close();
	process.exit(1);
}

const modelSize = name => {
	if (/-vl\b|-vision\b|whisper/i.test(name)) return 0;
	const p = name.match(/(\d+(?:\.\d+)?)\s*([bm])(?:-|$)/i);
	const b = name.match(/(?:-|\b)(\d+)-?bit/i);
	if (!p) return 0;
	const params = Number(p[1]) * (p[2].toUpperCase() === "B" ? 1e9 : 1e6);
	const bits = b ? Number(b[1]) : 16;
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
const roots = [
	"/tmp/mlx-models",
	`${homedir()}/.cache/huggingface/hub`,
	`${homedir()}/models`,
	`${homedir()}/Models`
];
const scan = async (directory, depth = 0) => {
	if (depth > 4 || /whisper/i.test(directory)) return;
	let entries;
	try { entries = await readdir(directory, { withFileTypes: true }); } catch { return; }
	const weights = entries.filter(e => /\.(safetensors|bin|gguf)$/i.test(e.name));
	if (entries.some(e => e.name === "config.json") && weights.length) {
		let bytes = 0;
		for (const w of weights) {
			try { bytes += (await stat(`${directory}/${w.name}`)).size; } catch {}
		}
		const hubMatch = directory.match(/models--([^/]+)/);
		const name = hubMatch ? hubMatch[1].replaceAll("--", "/") : directory.split("/").pop().replaceAll("--", "/");
		if (!localModels.some(m => m.name === name)) localModels.push({ name, path: directory, bytes, local: true });
		return;
	}
	for (const e of entries.filter(e => e.isDirectory())) await scan(`${directory}/${e.name}`, depth + 1);
};
for (const root of roots) await scan(root);

const budget = totalmem() * 0.65;
const candidates = localModels.filter(m => m.bytes <= budget);
try {
	const response = await fetch("https://huggingface.co/api/models?author=mlx-community&search=Instruct&sort=downloads&direction=-1&limit=100", { signal: AbortSignal.timeout(8000) });
	if (response.ok) {
		for (const model of await response.json()) {
			const bytes = modelSize(model.id);
			if (bytes && bytes <= budget && !candidates.some(c => c.name === model.id)) candidates.push({ name: model.id, bytes });
		}
	}
} catch {}

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

	let selectedModel = model.local ? model.path : null;
	if (!model.local) {
		const modelPath = `/tmp/mlx-models/${model.name.replaceAll("/", "--")}`;
		if (await confirmDiskSpace("/tmp", model.bytes * 1.1)) {
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
			const download = spawnProc(python, ["-c", "from huggingface_hub import snapshot_download; snapshot_download(repo_id=__import__('os').environ['MODEL_ID'], local_dir=__import__('os').environ['MODEL_DIR'])"], {
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
			} else await rm(modelPath, { recursive: true, force: true });
		} else console.log("Download skipped.");
	}
	if (!selectedModel) break;

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
	console.log(`\nRunning MLX benchmark for ${model.name}...`);
	const test = spawnProc(python, ["-c", benchmark], {
		env: { ...process.env, MODEL_PATH: selectedModel },
		capture: true
	});
	const benchmarkSuccess = (await test.exited) === 0;
	const output = test.getOutput();
	if (benchmarkSuccess) {
		const results = output.trim().split("\n").filter(Boolean).map(JSON.parse);
		if (results.length) {
			const meanTps = results.reduce((s, r) => s + r.tps, 0) / results.length;
			console.log("\n========== MLX TOKEN TEST ==========");
			results.forEach((r, i) => console.log(`${i + 1}. TTFT: ${(r.ttft * 1000).toFixed(0)} ms | Tok/s: ${r.tps.toFixed(2)} | Tokens: ${r.tokens}`));
			console.log(`Mean TTFT: ${(results.reduce((s, r) => s + r.ttft, 0) / results.length * 1000).toFixed(0)} ms | Mean Tok/s: ${meanTps.toFixed(2)}`);
			console.log("=====================================");
			if (/^y(es)?$/i.test(await ask(`Show how fast ${meanTps.toFixed(1)} tok/s looks like? [y/N] `) ?? "")) {
				const words = "Artificial intelligence and large language models process text by predicting the next token in a sequence. With Apple Silicon unified memory architecture, weights are streamed with high bandwidth directly to the GPU cores. ".repeat(5).match(/\s*\S+/g);
				const demoStart = performance.now();
				for (let i = 0; performance.now() - demoStart < 4000; i++) {
					process.stdout.write(words[i % words.length]);
					await sleep(1000 / meanTps);
				}
				console.log("\n");
			}
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
