import { basename } from "node:path";
import type { Note } from "./core.ts";

export type Level = "active" | "timeSensitive";

export interface Message {
	title: string;
	subtitle: string;
	body: string;
	level: Level;
}

const COPY = {
	zh: { done: "完成", fail: "失败", ask: "需要你", remind: "仍在等你", waiting: "等你回复" },
	en: { done: "Done", fail: "Failed", ask: "Needs you", remind: "Still waiting", waiting: "Waiting for your reply" },
};

const MARK = { done: "✓", fail: "✗", ask: "●" } as const;

export function isChinese(env: NodeJS.ProcessEnv = process.env): boolean {
	const hint = env.LC_ALL || env.LC_MESSAGES || env.LANG || Intl.DateTimeFormat().resolvedOptions().locale;
	return /^zh/i.test(hint);
}

/** `45s`, `2m14s`, `1h3m`. */
export function duration(ms: number): string {
	const total = Math.max(0, Math.round(ms / 1000));
	if (total < 60) return `${total}s`;
	const m = Math.floor(total / 60);
	const s = total % 60;
	if (m < 60) return s ? `${m}m${s}s` : `${m}m`;
	const h = Math.floor(m / 60);
	return m % 60 ? `${h}h${m % 60}m` : `${h}h`;
}

/** First meaningful line, stripped of markdown noise, cut to `max` characters. */
export function oneLine(text: string | undefined, max = 90): string {
	if (!text) return "";
	for (const raw of text.split(/\r?\n/)) {
		const line = raw
			.replace(/^\s*(?:#{1,6}|>|[-*+]|\d+[.)])\s+/, "")
			.replace(/[`*_~]/g, "")
			.replace(/\s+/g, " ")
			.trim();
		if (!line) continue;
		const chars = Array.from(line);
		return chars.length <= max ? line : `${chars.slice(0, max - 1).join("").trimEnd()}…`;
	}
	return "";
}

export function repoName(cwd: string): string {
	return basename(cwd) || cwd;
}

export function render(note: Note, cwd: string, opts: { zh: boolean; detail: boolean }): Message {
	const c = opts.zh ? COPY.zh : COPY.en;
	const label = note.remind ? c.remind : c[note.kind];
	const subtitle = note.elapsedMs && note.elapsedMs >= 1000 ? `${label} · ${duration(note.elapsedMs)}` : label;
	const detail = opts.detail ? oneLine(note.text) : "";
	const body = detail || (note.kind === "ask" && opts.detail ? c.waiting : "");
	return {
		title: `${MARK[note.kind]} ${repoName(cwd)}`,
		subtitle,
		body,
		level: note.kind === "done" ? "active" : "timeSensitive",
	};
}
