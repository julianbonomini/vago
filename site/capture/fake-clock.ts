// The capture's clock: `Date` and `setInterval` replaced for the whole process, so every capture draws the
// same frames. Time moves only when the capture sets it, and the TUI's once-a-second reads run only when it
// asks for them. Hides how the globals are swapped.

const RealDate = Date;
let now = 0;
const intervals = new Map<number, () => unknown>();
let nextInterval = 1;

/** Installs the clock at `start`, in the UTC time zone, before anything reads the time. */
export function installFakeClock(start: Date): void {
	process.env.TZ = "UTC";
	now = start.getTime();
	// A `Date` built with no argument, or `Date.now()`, reads the fake time; one built from a value is as
	// usual. Vago never builds one from year, month and day.
	class FakeDate extends RealDate {
		constructor(value?: number | string | Date) {
			super(value ?? now);
		}
		static override now(): number {
			return now;
		}
		// Dates made before the swap, or by a class extending the real Date, are still Dates.
		static override [Symbol.hasInstance](value: unknown): boolean {
			return value instanceof RealDate;
		}
	}
	// Defined, not assigned: the fakes don't take every argument the real ones do, nor return a Timer.
	Object.defineProperty(globalThis, "Date", { value: FakeDate });
	Object.defineProperty(globalThis, "setInterval", {
		value: (callback: () => unknown) => {
			const id = nextInterval++;
			intervals.set(id, callback);
			return id;
		},
	});
	Object.defineProperty(globalThis, "clearInterval", {
		value: (id: number) => intervals.delete(id),
	});
}

/** Sets the time to `time`. */
export function setFakeTime(time: Date): void {
	now = time.getTime();
}

/** Runs every interval once, as if its period had passed, and waits for the reads they start. */
export async function tickIntervals(): Promise<void> {
	await Promise.all([...intervals.values()].map((callback) => callback()));
}
