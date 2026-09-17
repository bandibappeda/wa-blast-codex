import { describe, expect, test } from "bun:test";
import { campaignStates, canTransition, assertCampaignTransition, CampaignStateError } from "./campaign-state";

describe("campaign state machine", () => {
  test("allows only the approved lifecycle transitions", () => {
    expect(campaignStates).toEqual(["draft", "pending_approval", "approved", "scheduled", "queued", "running", "completed", "completed_with_failures", "cancelled"]);
    expect(canTransition("draft", "pending_approval")).toBe(true);
    expect(canTransition("approved", "scheduled")).toBe(true);
    expect(canTransition("scheduled", "queued")).toBe(true);
    expect(canTransition("running", "completed_with_failures")).toBe(true);
    expect(canTransition("draft", "queued")).toBe(false);
    expect(canTransition("completed", "draft")).toBe(false);
  });

  test("throws a domain error for invalid transitions", () => {
    expect(() => assertCampaignTransition("draft", "running")).toThrow(CampaignStateError);
  });
});
