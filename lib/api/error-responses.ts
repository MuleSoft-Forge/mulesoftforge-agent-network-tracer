import { NextResponse } from "next/server";
import { ZodError } from "zod";

/**
 * Create a validation error response
 */
export function validationError(error: ZodError) {
  return NextResponse.json(
    {
      error: "Invalid request",
      details: error.format(),
    },
    { status: 400 }
  );
}

/**
 * Create an API error response
 */
export function apiError(message: string, status: number, details?: string) {
  return NextResponse.json(
    {
      error: message,
      ...(details && { details: details.slice(0, 200) }),
    },
    { status }
  );
}
