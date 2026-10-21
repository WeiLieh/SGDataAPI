# Product Backlog

Enhancements and ideas the owner wants later. Nothing here is built until the owner asks for that item; when one is built, its status changes to "Done" with the date and pull request, and the change is recorded in `Context.md` as usual. Bugs go in `error_log.txt`, and issues left open on purpose go in `KnownIssues.md`.

## PB-1: Use the bot's own name, HazeUncle, in its replies

- **Type:** Enhancement (Telegram bot). **Added:** 2026-10-21. **Status:** Done (2026-10-21, branch claude-brain, with Phase 2).
- **Now:** the `/start` and `/help` replies begin "SG Weather bot: Singapore air quality from data.gov.sg." (`HELP_TEXT` in `shared/bot/handle-command.ts`).
- **Wanted:** the replies name the bot as it is called in Telegram, **HazeUncle**, instead of "SG Weather bot".
- **Notes:** the web app keeps its name, SG Weather. Keep the brain channel-neutral, so a future WhatsApp adapter shows the same name. Update the tests that check the help text.

## PB-2: A more natural, less repetitive Haze Uncle voice

- **Type:** Enhancement (Haze Uncle / Claude persona). **Added:** 2026-10-21. **Status:** Open.
- **Now:** the owner's voice check on the preview passed (8 of 8), and the replies use Singlish, but they sound robotic and monotonous. Some phrases come back almost every time with no variation, for example "if you feel unwell, please see a doctor, can?".
- **Wanted:** more authentic, natural Singlish, like a real elderly uncle chatting, with much less repetition from one reply to the next.
- **Notes:** the voice lives in `SYSTEM_PROMPT` in `shared/bot/persona.ts`. Likely changes: describe how a real uncle talks (varied particles, short natural sentences, small local touches) instead of listing a few fixed words; say the doctor advice only when the person raises a health worry, and in different words each time; ask for varied openings and endings. Keep the rules that numbers, bands, recommendations, times and the disclaimer stay exact plain English. The owner's fixed notices are not part of this. Re-run the voice check on a preview (a few cents, with the owner's approval); effort level or model may also be compared.
