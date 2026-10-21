# Product Backlog

Enhancements and ideas the owner wants later. Nothing here is built until the owner asks for that item; when one is built, its status changes to "Done" with the date and pull request, and the change is recorded in `Context.md` as usual. Bugs go in `error_log.txt`, and issues left open on purpose go in `KnownIssues.md`.

## PB-1: Use the bot's own name, HazeUncle, in its replies

- **Type:** Enhancement (Telegram bot). **Added:** 2026-10-21. **Status:** Done (2026-10-21, branch claude-brain, with Phase 2).
- **Now:** the `/start` and `/help` replies begin "SG Weather bot: Singapore air quality from data.gov.sg." (`HELP_TEXT` in `shared/bot/handle-command.ts`).
- **Wanted:** the replies name the bot as it is called in Telegram, **HazeUncle**, instead of "SG Weather bot".
- **Notes:** the web app keeps its name, SG Weather. Keep the brain channel-neutral, so a future WhatsApp adapter shows the same name. Update the tests that check the help text.
