import { expect, test } from "bun:test";
import { parseKey } from "../src/bark.ts";
import { duration, oneLine, question, render } from "../src/text.ts";

test("duration", () => {
	expect([0, 45_000, 134_000, 180_000, 3_780_000, 7_200_000].map(duration)).toEqual(["0s", "45s", "2m14s", "3m", "1h3m", "2h"]);
});

test("oneLine takes the first real line without markdown noise", () => {
	expect(oneLine("\n\n## **Done**: tests pass\nmore")).toBe("Done: tests pass");
	expect(oneLine("- `fix` the bug")).toBe("fix the bug");
	expect(oneLine("")).toBe("");
	expect(oneLine("x".repeat(200), 10)).toBe("xxxxxxxxx…");
});

test("question picks the sentence a reply ends on, only if it asks", () => {
	expect(question("Tests pass.\n\nShould I **merge** it now?")).toBe("Should I merge it now?");
	expect(question("改好了。要不要发一版新的？")).toBe("要不要发一版新的？");
	expect(question("Done. Want me to push it (y/n)?)")).toBe("Want me to push it (y/n)?");
	expect(question("Why did it fail? Because of X.")).toBeUndefined();
	expect(question("All green.")).toBeUndefined();
	expect(question(undefined)).toBeUndefined();
});

test("render: done is calm, decisions are time sensitive", () => {
	const done = render({ kind: "done", elapsedMs: 134_000, text: "ok" }, "/w/pi-footer", { zh: true, detail: true });
	expect(done).toEqual({ title: "✓ pi-footer", subtitle: "完成 · 2m14s", body: "ok", level: "active" });
	const ask = render({ kind: "ask", text: "Delete?" }, "/w/pi-footer", { zh: false, detail: true });
	expect(ask).toMatchObject({ title: "● pi-footer", subtitle: "Needs you", body: "Delete?", level: "timeSensitive" });
	const again = render({ kind: "ask", remind: true, elapsedMs: 600_000 }, "/w/x", { zh: false, detail: true });
	expect(again.subtitle).toBe("Still waiting · 10m");
});

test("render: detail off sends only project and state", () => {
	const m = render({ kind: "ask", text: "secret question" }, "/w/x", { zh: false, detail: false });
	expect(m.body).toBe("");
	expect(render({ kind: "fail", text: "secret" }, "/w/x", { zh: false, detail: false }).body).toBe("");
});

test("parseKey takes a bare key or the URL the Bark app shows", () => {
	expect(parseKey("AbCdEf123456")).toEqual({ key: "AbCdEf123456" });
	expect(parseKey("https://api.day.app/AbCdEf123456/推送内容")).toEqual({ key: "AbCdEf123456", server: "https://api.day.app" });
	expect(parseKey("https://bark.example.com:8080/KEY123456")).toEqual({ key: "KEY123456", server: "https://bark.example.com:8080" });
	expect(parseKey("no way")).toBeUndefined();
	expect(parseKey("")).toBeUndefined();
});
