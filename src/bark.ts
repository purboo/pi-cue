import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { DEFAULT_TIMING, type Timing } from "./core.ts";

export const DEFAULT_SERVER = "https://api.day.app";

export interface Config {
	key: string;
	server: string;
	/** Whether new sessions start with cues on. */
	on: boolean;
	/** Include the result / question text. Off sends only the project and state. */
	detail: boolean;
	timing: Timing;
}

export function configPath(env: NodeJS.ProcessEnv = process.env): string {
	return join(env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent"), "cue.json");
}

const positive = (v: unknown, fallback: number, allowZero = false): number =>
	typeof v === "number" && Number.isFinite(v) && (allowZero ? v >= 0 : v > 0) ? v : fallback;

export function loadConfig(env: NodeJS.ProcessEnv = process.env, path = configPath(env)): Config {
	let file: Record<string, unknown> = {};
	try {
		const parsed = JSON.parse(readFileSync(path, "utf8"));
		if (parsed && typeof parsed === "object") file = parsed;
	} catch {
		// no file yet
	}
	const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : "");
	const t = DEFAULT_TIMING;
	return {
		key: str(env.PI_CUE_KEY) || str(file.key),
		server: (str(env.PI_CUE_SERVER) || str(file.server) || DEFAULT_SERVER).replace(/\/+$/, ""),
		on: env.PI_CUE === "1" || file.default === "on",
		detail: file.detail !== false,
		timing: {
			graceMs: positive(file.graceMs, t.graceMs),
			askGraceMs: positive(file.askGraceMs, t.askGraceMs),
			minRunMs: positive(file.minRunMs, t.minRunMs, true),
			remindMs: positive(file.remindMs, t.remindMs, true),
		},
	};
}

/** Accepts a bare key or the URL the Bark app shows (`https://host/KEY` or `https://host/KEY/...`). */
export function parseKey(input: string): { key: string; server?: string } | undefined {
	const text = input.trim();
	if (!text) return undefined;
	if (/^https?:\/\//i.test(text)) {
		try {
			const url = new URL(text);
			const key = url.pathname.split("/").filter(Boolean)[0];
			return key ? { key, server: url.origin } : undefined;
		} catch {
			return undefined;
		}
	}
	return /^[\w-]{6,}$/.test(text) ? { key: text } : undefined;
}

/** Saves the key without disturbing other settings; the file holds a secret, so owner-only. */
export function saveKey(found: { key: string; server?: string }, path = configPath()): void {
	let file: Record<string, unknown> = {};
	try {
		file = JSON.parse(readFileSync(path, "utf8"));
	} catch {
		// first save
	}
	file.key = found.key;
	if (found.server && found.server !== DEFAULT_SERVER) file.server = found.server;
	else delete file.server;
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(file, null, 2)}\n`, { mode: 0o600 });
	chmodSync(path, 0o600);
}

export interface Push {
	id: string;
	group: string;
	title: string;
	subtitle: string;
	body: string;
	level: string;
}

async function post(cfg: Config, payload: Record<string, unknown>, fetcher: typeof fetch): Promise<boolean> {
	if (!cfg.key) return false;
	try {
		const res = await fetcher(`${cfg.server}/push`, {
			method: "POST",
			headers: { "content-type": "application/json; charset=utf-8" },
			body: JSON.stringify({ device_key: cfg.key, ...payload }),
			signal: AbortSignal.timeout(4_000),
		});
		return res.ok;
	} catch {
		return false; // best effort: a missed tap must never disturb pi
	}
}

export const push = (cfg: Config, p: Push, fetcher: typeof fetch = fetch) => post(cfg, { ...p }, fetcher);

/** Deleting is a silent push, so Bark needs Background App Refresh to act on it. */
export const remove = (cfg: Config, id: string, fetcher: typeof fetch = fetch) =>
	post(cfg, { id, delete: "1" }, fetcher);
