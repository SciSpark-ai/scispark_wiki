import { describe, it, expect, beforeEach } from "vitest";
import { useCompanionStore } from "../companion-store";
import type { CompanionUtterance } from "@/lib/companion/run";

function makeUtterance(overrides: Partial<CompanionUtterance> = {}): CompanionUtterance {
  return {
    trigger: "app-open",
    text: "Your feed's ready — want to see what's new?",
    action: { label: "Home", href: "/" },
    costUsd: 0,
    fromTemplate: true,
    ...overrides,
  };
}

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

describe("useCompanionStore", () => {
  beforeEach(() => {
    // Reset the singleton store's state between tests.
    useCompanionStore.setState(useCompanionStore.getInitialState(), true);
  });

  it("starts with no current utterance, a zero session count, and no stamps", () => {
    const s = useCompanionStore.getState();
    expect(s.current).toBeNull();
    expect(s.sessionShownCount).toBe(0);
    expect(s.lastShownTs).toEqual({});
  });

  it("show() sets current, increments sessionShownCount, and stamps lastShownTs[trigger]", () => {
    const u = makeUtterance({ trigger: "post-ingest" });
    useCompanionStore.getState().show(u);

    const s = useCompanionStore.getState();
    expect(s.current).toEqual(u);
    expect(s.sessionShownCount).toBe(1);
    expect(s.lastShownTs["post-ingest"]).toMatch(ISO_RE);
  });

  it("repeated show() calls keep incrementing the count and overwrite the trigger's stamp", () => {
    useCompanionStore.getState().show(makeUtterance({ trigger: "app-open" }));
    const firstStamp = useCompanionStore.getState().lastShownTs["app-open"];

    useCompanionStore.getState().show(makeUtterance({ trigger: "app-open", text: "second" }));
    const s = useCompanionStore.getState();

    expect(s.sessionShownCount).toBe(2);
    expect(s.current?.text).toBe("second");
    expect(s.lastShownTs["app-open"]).toMatch(ISO_RE);
    // Both stamps are valid ISO timestamps for the same trigger; the second
    // call's stamp is not earlier than the first's.
    expect(new Date(s.lastShownTs["app-open"]).getTime()).toBeGreaterThanOrEqual(
      new Date(firstStamp).getTime(),
    );
  });

  it("show() preserves stamps for other triggers already recorded", () => {
    useCompanionStore.getState().show(makeUtterance({ trigger: "review-pending" }));
    const reviewStamp = useCompanionStore.getState().lastShownTs["review-pending"];

    useCompanionStore.getState().show(makeUtterance({ trigger: "post-ingest" }));
    const s = useCompanionStore.getState();

    expect(s.lastShownTs["review-pending"]).toBe(reviewStamp);
    expect(s.lastShownTs["post-ingest"]).toMatch(ISO_RE);
  });

  it("dismiss() clears current only, leaving sessionShownCount and lastShownTs untouched", () => {
    useCompanionStore.getState().show(makeUtterance({ trigger: "app-open" }));
    const countBefore = useCompanionStore.getState().sessionShownCount;
    const stampsBefore = useCompanionStore.getState().lastShownTs;

    useCompanionStore.getState().dismiss();

    const s = useCompanionStore.getState();
    expect(s.current).toBeNull();
    expect(s.sessionShownCount).toBe(countBefore);
    expect(s.lastShownTs).toEqual(stampsBefore);
  });

  it("dismiss() on an already-idle store is a no-op", () => {
    useCompanionStore.getState().dismiss();
    const s = useCompanionStore.getState();
    expect(s.current).toBeNull();
    expect(s.sessionShownCount).toBe(0);
  });
});
