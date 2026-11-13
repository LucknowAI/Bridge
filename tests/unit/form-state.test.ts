import { describe, expect, it, vi } from "vitest";
import { redirect } from "next/navigation";
import { initialFormState, runFormAction, userMessage } from "@/lib/form-state";
import { ValidationError } from "@/src/domain/shared/validation";

function submitted() {
  const formData = new FormData();
  formData.set("designation", "Engineer");
  formData.set("aboutMe", "x".repeat(20));
  formData.set("file", new File(["data"], "roster.xlsx"));
  return formData;
}

describe("runFormAction", () => {
  it("returns a clean state when the action succeeds", async () => {
    await expect(runFormAction(submitted(), async () => {})).resolves.toEqual(initialFormState);
  });

  it("puts a validation error on its field and keeps the typed text", async () => {
    const state = await runFormAction(submitted(), async () => {
      throw new ValidationError("aboutMe", "About you must be 10 characters or fewer");
    });
    expect(state.fieldErrors).toEqual({ aboutMe: "About you must be 10 characters or fewer" });
    expect(state.error).toBe("Check the highlighted field and try again.");
    expect(state.values).toEqual({ designation: "Engineer", aboutMe: "x".repeat(20) });
  });

  it("shows application errors as the form message", async () => {
    const state = await runFormAction(submitted(), async () => { throw new Error("This event is not accepting profiles"); });
    expect(state).toMatchObject({ error: "This event is not accepting profiles", fieldErrors: {} });
  });

  it("hides database errors behind a generic message", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const dbError = Object.assign(new Error("duplicate key value violates unique constraint"), { code: "23505" });
    const state = await runFormAction(submitted(), async () => { throw dbError; });
    expect(state.error).toMatch(/Something went wrong/);
    expect(state.values.designation).toBe("Engineer");
  });

  it("lets a successful redirect through", async () => {
    await expect(runFormAction(submitted(), async () => redirect("/e/demo/matches"))).rejects.toThrow("NEXT_REDIRECT");
  });
});

describe("userMessage", () => {
  it("uses the fallback for non-Error values", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(userMessage("boom", "Try again")).toBe("Try again");
  });
});
