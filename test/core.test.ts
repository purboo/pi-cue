import { beforeEach, expect, test } from "bun:test";
import { createCue, DEFAULT_TIMING, type Note, isHumanKey } from "../src/core.ts";

/** A fake clock: `tick(ms)` advances time and runs due timers in order. */
function harness(timing = DEFAULT_TIMING) {
	let t = 1_000_000;
	let seq = 0;
	const timers = new Map<number, { at: number; fn: () => void }>();
	const sent: Note[] = [];
	let withdrawn = 0;
	const cue = createCue(
		{
			now: () => t,
			after(ms, fn) {
				const id = seq++;
				timers.set(id, { at: t + ms, fn });
				return () => void timers.delete(id);
			},
			send: (n) => void sent.push(n),
			withdraw: () => void withdrawn++,
		},
		timing,
	);
	const tick = (ms: number) => {
		const end = t + ms;
		for (;;) {
			const due = [...timers.entries()].filter(([, v]) => v.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
			if (!due) break;
			timers.delete(due[0]);
			t = due[1].at;
			due[1].fn();
		}
		t = end;
	};
	return { cue, tick, sent, withdrawn: () => withdrawn, pending: () => timers.size };
}

const S = 1000;
const MIN = 60 * S;
let h: ReturnType<typeof harness>;
beforeEach(() => {
	h = harness();
	h.cue.setEnabled(true);
});

const run = (ms: number, extra: { aborted?: boolean; failed?: boolean; text?: string } = {}) => {
	h.cue.runStart();
	h.tick(ms);
	h.cue.settled({ aborted: false, failed: false, ...extra });
};

test("a long run that ends while you are away taps after the grace period", () => {
	run(2 * MIN, { text: "All green" });
	h.tick(14 * S);
	expect(h.sent).toEqual([]);
	h.tick(1 * S);
	expect(h.sent).toEqual([{ kind: "done", elapsedMs: 2 * MIN, text: "All green" }]);
});

test("short runs stay silent, failures never do", () => {
	run(10 * S);
	h.tick(MIN);
	expect(h.sent).toEqual([]);
	run(10 * S, { failed: true, text: "boom" });
	h.tick(MIN);
	expect(h.sent.map((n) => n.kind)).toEqual(["fail"]);
});

test("aborting with escape is you being here: no tap", () => {
	run(2 * MIN, { aborted: true });
	h.tick(MIN);
	expect(h.sent).toEqual([]);
});

test("typing during the grace period cancels the tap", () => {
	run(2 * MIN);
	h.tick(5 * S);
	h.cue.input();
	h.tick(MIN);
	expect(h.sent).toEqual([]);
});

test("typing just before the run ends also counts as being here", () => {
	h.cue.runStart();
	h.tick(2 * MIN);
	h.cue.input();
	h.tick(3 * S);
	h.cue.settled({ aborted: false, failed: false });
	h.tick(MIN);
	expect(h.sent).toEqual([]);
});

test("typing long before the run ends does not", () => {
	h.cue.input();
	run(2 * MIN);
	h.tick(MIN);
	expect(h.sent.length).toBe(1);
});

test("a new run cancels a pending tap and clears one already sent", () => {
	run(2 * MIN);
	h.tick(5 * S);
	h.cue.runStart();
	h.tick(MIN);
	expect(h.sent).toEqual([]);

	h.cue.settled({ aborted: false, failed: false });
	h.tick(20 * S);
	expect(h.sent.length).toBe(1);
	h.cue.runStart();
	expect(h.withdrawn()).toBe(1);
});

test("a decision taps after its shorter grace, and is withdrawn once answered", () => {
	h.cue.promptStart("Delete the branch?");
	h.tick(7 * S);
	expect(h.sent).toEqual([]);
	h.tick(1 * S);
	expect(h.sent).toEqual([{ kind: "ask", text: "Delete the branch?" }]);
	h.cue.promptEnd();
	expect(h.withdrawn()).toBe(1);
});

test("answering inside the grace period sends nothing", () => {
	h.cue.promptStart("Proceed?");
	h.tick(3 * S);
	h.cue.promptEnd();
	h.tick(MIN);
	expect(h.sent).toEqual([]);
	expect(h.withdrawn()).toBe(0);
});

test("an unanswered decision gets exactly one reminder", () => {
	h.cue.promptStart("Proceed?");
	h.tick(8 * S);
	h.tick(10 * MIN);
	expect(h.sent.map((n) => [n.kind, n.remind ?? false])).toEqual([["ask", false], ["ask", true]]);
	h.tick(60 * MIN);
	expect(h.sent.length).toBe(2);
});

test("answering cancels the reminder", () => {
	h.cue.promptStart("Proceed?");
	h.tick(8 * S);
	h.cue.promptEnd();
	h.tick(60 * MIN);
	expect(h.sent.length).toBe(1);
});

test("typing after a tap takes it off the phone, once", () => {
	run(2 * MIN);
	h.tick(15 * S);
	h.cue.input();
	h.cue.input();
	expect(h.withdrawn()).toBe(1);
});

test("nested prompts count as one decision", () => {
	h.cue.promptStart("a");
	h.cue.promptStart("b");
	h.tick(8 * S);
	expect(h.sent.length).toBe(1);
	h.cue.promptEnd();
	expect(h.withdrawn()).toBe(0);
	h.cue.promptEnd();
	expect(h.withdrawn()).toBe(1);
});

test("off means silent, and clears what is on the phone", () => {
	run(2 * MIN);
	h.tick(15 * S);
	h.cue.setEnabled(false);
	expect(h.withdrawn()).toBe(1);
	run(2 * MIN);
	h.cue.promptStart("x");
	h.tick(MIN);
	expect(h.sent.length).toBe(1);
	expect(h.pending()).toBe(0);
});

test("reset forgets everything without touching the phone", () => {
	run(2 * MIN);
	h.cue.reset();
	h.tick(MIN);
	expect(h.sent).toEqual([]);
	expect(h.withdrawn()).toBe(0);
});

test("only real key presses show presence", () => {
	for (const key of ["a", "\r", "\x1b", "\x1b[A", "\x03", "\x1b[200~", "\x1bb"]) expect(isHumanKey(key)).toBe(true);
	for (const noise of ["", "\x1b[I", "\x1b[O", "\x1b[<0;10;5M", "\x1b[?62;c", "\x1b[12;40R", "\x1b]11;rgb:0000/0000/0000\x07"])
		expect(isHumanKey(noise)).toBe(false);
});
