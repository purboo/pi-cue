/**
 * pi-cue: a tap on the wrist when pi is done, or needs you.
 *
 * Off by default per session; `/cue` turns it on for the current one.
 * All logic lives in src/core.ts; this file only wires pi events to it.
 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { type Config, loadConfig, parseKey, push, remove, saveKey } from "./src/bark.ts";
import { type Cue, createCue, isHumanKey, type Note } from "./src/core.ts";
import { isChinese, render, repoName } from "./src/text.ts";

const ENTRY = "pi-cue";
const STATUS = "cue";

interface MessageLike {
	role?: string;
	stopReason?: string;
	errorMessage?: string;
	content?: unknown;
}

function textOf(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.map((p) => (p && (p as { type?: string }).type === "text" ? String((p as { text?: unknown }).text ?? "") : ""))
		.join("\n");
}

export default function piCue(pi: ExtensionAPI): void {
	let cfg: Config = loadConfig();
	let cwd = process.cwd();
	let sessionId = "";
	let unlisten: (() => void) | undefined;
	let last: { failed: boolean; text: string } = { failed: false, text: "" };
	const zh = isChinese();

	const id = () => `cue-${sessionId}`;

	const cue: Cue = createCue(
		{
			now: Date.now,
			after(ms, fn) {
				const t = setTimeout(fn, ms);
				t.unref?.(); // never keep pi alive for a tap
				return () => clearTimeout(t);
			},
			send(note: Note) {
				const m = render(note, cwd, { zh, detail: cfg.detail });
				void push(cfg, { id: id(), group: repoName(cwd), ...m });
			},
			withdraw() {
				void remove(cfg, id());
			},
		},
		cfg.timing,
	);

	const showStatus = (ctx: ExtensionContext) => {
		if (ctx.hasUI) ctx.ui.setStatus(STATUS, cue.isEnabled() ? "cue" : undefined);
	};

	const restored = (ctx: ExtensionContext): boolean | undefined => {
		const branch = ctx.sessionManager.getBranch();
		for (let i = branch.length - 1; i >= 0; i--) {
			const e = branch[i] as { type?: string; customType?: string; data?: { on?: boolean } };
			if (e.type === "custom" && e.customType === ENTRY && typeof e.data?.on === "boolean") return e.data.on;
		}
		return undefined;
	};

	pi.on("session_start", (_e, ctx) => {
		cue.reset();
		unlisten?.();
		unlisten = undefined;
		cfg = loadConfig();
		cwd = ctx.cwd;
		sessionId = ctx.sessionManager.getSessionId().slice(0, 8);
		last = { failed: false, text: "" };
		if (!ctx.hasUI) return; // nested and headless sessions never tap
		unlisten = ctx.ui.onTerminalInput((data) => {
			if (isHumanKey(data)) cue.input();
			return undefined;
		});
		cue.setEnabled((restored(ctx) ?? cfg.on) && !!cfg.key);
		showStatus(ctx);
	});

	pi.on("agent_start", (_e, ctx) => {
		cwd = ctx.cwd;
		last = { failed: false, text: "" };
		cue.runStart();
	});

	// agent_end fires per attempt and pi may still retry; agent_settled is final.
	pi.on("agent_end", (e) => {
		const msg = [...e.messages].reverse().find((m) => (m as MessageLike).role === "assistant") as
			| MessageLike
			| undefined;
		const failed = msg?.stopReason === "error";
		last = { failed, text: failed ? (msg?.errorMessage ?? "") : textOf(msg?.content) };
	});

	pi.on("agent_settled", (e, ctx) => {
		cwd = ctx.cwd;
		cue.settled({ aborted: e.aborted, failed: last.failed, text: last.text });
	});

	pi.on("ui_prompt_start", (e) => cue.promptStart(e.title));
	pi.on("ui_prompt_end", () => cue.promptEnd());

	pi.on("session_shutdown", async () => {
		unlisten?.();
		unlisten = undefined;
		// Quitting means you are here: clear what is still on the phone, and wait for it
		// so the request is not cut off by the process exiting.
		const onPhone = cue.isLive();
		cue.reset();
		if (onPhone) await remove(cfg, id());
	});

	const say = (ctx: ExtensionContext, msg: string, type: "info" | "warning" | "error" = "info") =>
		ctx.ui.notify(msg, type);

	const setOn = (ctx: ExtensionContext, on: boolean) => {
		if (on && !cfg.key) {
			say(ctx, zh ? "还没有 Bark key。先运行 /cue key <key 或 Bark 显示的 URL>" : "No Bark key yet. Run /cue key <key or the URL Bark shows>", "warning");
			return;
		}
		cue.setEnabled(on);
		pi.appendEntry(ENTRY, { on });
		showStatus(ctx);
		say(ctx, on ? (zh ? "cue 已开启:完成或需要你时会推送" : "cue on: you will be tapped when pi is done or needs you") : zh ? "cue 已关闭" : "cue off");
	};

	pi.registerCommand("cue", {
		description: "Tap on the wrist when pi is done or needs you (on | off | test | key <key>)",
		getArgumentCompletions: (prefix) =>
			["on", "off", "test", "key", "status"].filter((s) => s.startsWith(prefix)).map((s) => ({ value: s, label: s })),
		handler: async (args, ctx) => {
			const [sub = "", ...rest] = args.trim().split(/\s+/);
			switch (sub.toLowerCase()) {
				case "":
					return setOn(ctx, !cue.isEnabled());
				case "on":
					return setOn(ctx, true);
				case "off":
					return setOn(ctx, false);
				case "key": {
					const found = parseKey(rest.join(" "));
					if (!found) return say(ctx, zh ? "没认出这个 key。粘贴 Bark App 首页的 URL 或 key。" : "That does not look like a Bark key or URL.", "error");
					saveKey(found);
					cfg = loadConfig();
					return say(ctx, zh ? "key 已保存。运行 /cue test 试一条。" : "Key saved. Run /cue test to try one.");
				}
				case "test": {
					if (!cfg.key) return say(ctx, zh ? "还没有 key,先运行 /cue key" : "No key yet. Run /cue key first.", "warning");
					const m = render({ kind: "done", elapsedMs: 83_000, text: zh ? "这是一条测试" : "This is a test" }, cwd, { zh, detail: true });
					const ok = await push(cfg, { id: `${id()}-test`, group: repoName(cwd), ...m });
					return say(ctx, ok ? (zh ? "已发送" : "Sent") : zh ? "发送失败,检查 key 和网络" : "Send failed; check the key and network", ok ? "info" : "error");
				}
				case "status":
					return say(ctx, `cue ${cue.isEnabled() ? "on" : "off"} · key ${cfg.key ? "set" : "missing"} · ${cfg.server}`);
				default:
					return say(ctx, "/cue [on | off | test | key <key> | status]", "warning");
			}
		},
	});
}
