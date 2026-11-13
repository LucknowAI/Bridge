import { unstable_rethrow } from "next/navigation";
import { ValidationError } from "../src/domain/shared/validation";

/**
 * What a form action hands back to its form. `values` are the submitted text
 * fields, so a rejected submission re-renders with everything still filled in.
 */
export interface FormState {
  error: string | null;
  fieldErrors: Record<string, string>;
  values: Record<string, string>;
}

export const initialFormState: FormState = { error: null, fieldErrors: {}, values: {} };

/**
 * Runs a form action body. Redirects pass through; validation errors land on
 * their field; other errors go through userMessage.
 */
export async function runFormAction(formData: FormData, body: () => Promise<void>): Promise<FormState> {
  try {
    await body();
    return initialFormState;
  } catch (error) {
    unstable_rethrow(error);
    const values = textValues(formData);
    if (error instanceof ValidationError) {
      return {
        error: error.field ? "Check the highlighted field and try again." : error.message,
        fieldErrors: error.field ? { [error.field]: error.message } : {},
        values,
      };
    }
    return { error: userMessage(error, "Something went wrong. Your entries are kept, so you can try again."), fieldErrors: {}, values };
  }
}

/**
 * The message to show for an error thrown by application code. Production
 * builds hide thrown server-action messages, so actions return this instead.
 */
export function userMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && !("code" in error)) return error.message;
  console.error("[action] failed", error);
  return fallback;
}

function textValues(formData: FormData): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [key, value] of formData) {
    if (typeof value === "string" && !key.startsWith("$ACTION")) values[key] = value;
  }
  return values;
}
