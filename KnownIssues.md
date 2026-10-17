# Known Issues

Issues that are known, understood well enough to be judged harmless for now, and deliberately left in place by the owner. Each entry says what happens, why it is believed harmless, and when to revisit it. Errors are still logged in `error_log.txt`; this file lists the ones that stay open on purpose.

## KI-1: TypeScript `TS2688` errors in Vercel's deploy log

- **Recorded:** 2026-10-17. **Status:** open, left by the owner's decision (2026-10-17).
- **What happens:** every Vercel deployment's log shows this error twice, once for each server function (`api/data.ts`, `api/health.ts`), after "Using the TypeScript 7.0.2 compiler executable for transpilation.":

  ```
  error TS2688: Cannot find type definition file for 'node'.
    The file is in the program because:
      Entry point of type library 'node' specified in compilerOptions
  ```

  The log also counts 2 warnings that have not been read yet.
- **Why it is believed harmless:**
  - The deployment still completes ("Build Completed", "Deployment completed", status Ready).
  - The functions work: production `/api/health` answered 200, and the app shows live data.
  - Vercel uses TypeScript here only to turn the code into JavaScript; a type error does not stop that.
  - The project's real type check, `npm run check`, passes cleanly on the same code.
- **Likely cause (not confirmed):** Vercel's function compiler runs TypeScript 7 from a place where `tsconfig.json`'s `"types": ["node"]` cannot be resolved, even though `@types/node` is installed. TypeScript 7 being very new was flagged as a deploy risk on 2026-10-15.
- **Revisit when:** a Vercel build actually fails, an `api/` function misbehaves in production, the TypeScript or Vercel versions change, or the 2 warnings turn out to matter.
- **See also:** `error_log.txt` (2026-10-17 Deploy Error line).
