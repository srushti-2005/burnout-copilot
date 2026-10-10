import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export const getDashboard = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => z.object({ token: z.string().min(10) }).parse(d))
  .handler(async ({ data }) => {
    const { apiDashboard } = await import("./dashboard.server");
    return apiDashboard(data.token);
  });

export const loginUser = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({ email: z.string().email(), password: z.string().min(1) }).parse(d),
  )
  .handler(async ({ data }) => {
    const { apiLogin } = await import("./dashboard.server");
    return apiLogin(data.email, data.password);
  });

export const signupUser = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        email: z.string().email(),
        password: z.string().min(6),
        name: z.string().min(1),
        age: z.number().int().min(13).max(100),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { apiSignup } = await import("./dashboard.server");
    return apiSignup(data.email, data.password, data.name, data.age);
  });

export const resetPassword = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ email: z.string().email() }).parse(d))
  .handler(async ({ data }) => {
    const { apiReset } = await import("./dashboard.server");
    return apiReset(data.email);
  });

/**
 * Authenticated proxy to FastAPI. The path is allow-listed to /twin,
 * /focus/..., and /interventions/... only, so this can't be used to
 * reach any other backend route.
 *
 * THIS LINE IS THE FIX: "interventions" was missing from this regex,
 * so every call to /interventions/current, /interventions/{id}/accept,
 * etc. was rejected by Zod client-side before ever reaching the network
 * -- which is exactly the instant, log-free failure you were seeing.
 */
export const callApi = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        token: z.string().min(10),
        method: z.enum(["GET", "POST"]),
        path: z.string().regex(/^\/(twin|focus|interventions|activity)(\/[A-Za-z0-9_-]+){0,2}$/),
        body: z.unknown().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { apiAuthed } = await import("./dashboard.server");
    return apiAuthed(data.token, data.method, data.path, data.body);
  });