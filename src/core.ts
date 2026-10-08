/**
 * The decision logic, free of pi and the network. Everything time-related and
 * every side effect is injected, so it can be tested with a fake clock.
 *
 * The rule of thumb: a cue is a tap on the wrist, so it must only fire when
 * you are away. Every cue therefore waits a grace period, and is dropped if
 * you touched the keyboard around that time or the situation resolved itself.
 */

export type Kind = "done" | "fail" | "ask";

export interface Note {
	kind: Kind;
	/** Time since you last touched pi (done/fail/ask), or time spent waiting (reminder). */
	elapsedMs?: number;
	/** One-line detail: result summary, error, or the question being asked. */
	text?: string;
	/** Second and last nudge for a decision that nobody answered. */
	remind?: boolean;
}

export interface Timing {
	/** Wait before announcing a finished run. */
	graceMs: number;
	/** Wait before announcing a decision; shorter, because the agent is blocked. */
	askGraceMs: number;
	/**
	 * Only cue once you have been away this long, counted from your last key press,
	 * so a quick wrap-up run woken by a background subagent still counts. Failures always cue.
	 */
	minRunMs: number;
	/** Nudge once more if a decision is still open after this long. 0 = never. */
	remindMs: number;
}

export const DEFAULT_TIMING: Timing = {
	graceMs: 15_000,
	askGraceMs: 8_000,
	minRunMs: 30_000,
	remindMs: 10 * 60_000,
};

export interface Deps {
	now(): number;
	/** Run `fn` after `ms`; returns a canceller. */
	after(ms: number, fn: () => void): () => void;
	send(note: Note): void;
	/** Remove whatever this session last put on the phone. */
	withdraw(): void;
}

/** Keystrokes this recent before an event still count as "you are here". */
const PRESENT_MS = 5_000;

export interface Cue {
	setEnabled(on: boolean): void;
	isEnabled(): boolean;
	/** A cue from this session is currently on the phone. */
	isLive(): boolean;
	/** A human key press. */
	input(): void;
	/** `agent_start`. */
	runStart(): void;
	/**
	 * `agent_settled`. `question` is set when the reply ends by asking you something:
	 * the ball is in your court, so it cues like a dialog does.
	 */
	settled(run: { aborted: boolean; failed: boolean; text?: string; question?: string }): void;
	promptStart(title?: string): void;
	promptEnd(): void;
	/** New session in the same process: forget everything, touch nothing remote. */
	reset(): void;
}

export function createCue(deps: Deps, timing: Timing = DEFAULT_TIMING): Cue {
	let enabled = false;
	let lastInput = Number.NEGATIVE_INFINITY;
	let startedAt: number | null = null;
	let depth = 0;
	let live = false;
	/** `prompt`: waits on a dialog, so only the dialog closing resolves it, not a run boundary. */
	let pending: { prompt: boolean; cancel: () => void } | null = null;
	let cancelRemind: (() => void) | null = null;

	const drop = () => {
		pending?.cancel();
		pending = null;
	};

	const withdraw = () => {
		cancelRemind?.();
		cancelRemind = null;
		if (!live) return;
		live = false;
		deps.withdraw();
	};

	const dropRun = () => {
		if (pending && !pending.prompt) drop();
	};

	const schedule = (graceMs: number, note: Note, prompt = false) => {
		drop();
		const at = deps.now();
		const cancel = deps.after(graceMs, () => {
			pending = null;
			if (lastInput >= at - PRESENT_MS) return; // you are at the keyboard
			live = true;
			deps.send(note);
			if (note.kind === "ask" && timing.remindMs > 0) {
				cancelRemind = deps.after(timing.remindMs, () => {
					cancelRemind = null;
					deps.send({ ...note, remind: true, elapsedMs: timing.remindMs });
				});
			}
		});
		pending = { prompt, cancel };
	};

	return {
		setEnabled(on) {
			enabled = on;
			if (!on) {
				drop();
				withdraw();
			}
		},
		isEnabled: () => enabled,
		isLive: () => live,

		input() {
			lastInput = deps.now();
			// Typing means you have seen it; take it off the phone.
			if (live) withdraw();
		},

		runStart() {
			// Runs can restart on retry; keep the first start so the duration is the whole run.
			if (startedAt === null) startedAt = deps.now();
			dropRun();
			withdraw();
		},

		settled({ aborted, failed, text, question }) {
			const started = startedAt;
			startedAt = null;
			dropRun();
			if (!enabled || aborted) return;
			const now = deps.now();
			const since = Number.isFinite(lastInput) ? lastInput : (started ?? now);
			const elapsedMs = now - since;
			if (failed) return schedule(timing.graceMs, { kind: "fail", elapsedMs, text });
			if (elapsedMs < timing.minRunMs) return;
			if (question) return schedule(timing.askGraceMs, { kind: "ask", elapsedMs, text: question });
			schedule(timing.graceMs, { kind: "done", elapsedMs, text });
		},

		promptStart(title) {
			depth += 1;
			if (!enabled || depth > 1) return;
			schedule(timing.askGraceMs, { kind: "ask", text: title }, true);
		},

		promptEnd() {
			depth = Math.max(0, depth - 1);
			if (depth > 0) return;
			if (pending?.prompt) drop();
			withdraw();
		},

		reset() {
			drop();
			cancelRemind?.();
			cancelRemind = null;
			live = false;
			startedAt = null;
			depth = 0;
		},
	};
}

/**
 * Raw terminal input also carries things you did not type: focus reports,
 * mouse events, and replies to terminal queries. Only real keys show presence.
 */
export function isHumanKey(data: string): boolean {
	if (!data) return false;
	if (/^\x1b\[[IO]$/.test(data)) return false; // focus in / out
	if (/^\x1b\[[<?>]/.test(data)) return false; // SGR mouse, DEC and DA replies
	if (/^\x1b\[\d+;\d+R$/.test(data)) return false; // cursor position report
	if (/^\x1b[\]P_^]/.test(data)) return false; // OSC, DCS, APC, PM replies
	return true;
}
