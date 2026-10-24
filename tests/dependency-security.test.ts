import { expect, test } from "bun:test";
import * as z from "zod/v4";

// Oversized constrained collections must fail before validating every member.
// Keep inputs small: the visit counter reproduces the resource-amplification boundary.
for (const kind of ["max", "length"] as const) {
  test(`patched Zod rejects oversized ${kind} arrays before member validation`, () => {
    let visits = 0;
    const member = z.number().refine(() => { visits++; return true; });
    const schema = kind === "max" ? z.array(member).max(4) : z.array(member).length(4);
    expect(schema.safeParse(Array.from({ length: 32 }, () => 1)).success).toBeFalse();
    expect(visits).toBe(0);
    expect(schema.parse([1, 2, 3, 4])).toEqual([1, 2, 3, 4]);
    expect(visits).toBe(4);
  });
}
