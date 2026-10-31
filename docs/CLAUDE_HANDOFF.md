# Open prepared context in Claude

**Open in Claude** is the default and opens ordinary Claude chat at
`https://claude.ai/new`. Short prompts are prefilled using `q`. To avoid sending
large source packs in a URL, handoffs over 6,000 encoded URL characters are copied
in full and Claude opens with instructions to paste. No content is truncated.
Clipboard denial is reported explicitly; existing copy/preview/download options
remain available. Automatic opening after preparation also targets regular chat.

**Open in Claude Code (paid)** remains available separately for accounts with
Claude Code access. Signing in does not grant a Code subscription. Contexa cannot
read account eligibility, bypass an upgrade screen, or paste into a cross-origin
composer. If Code shows upgrade, use the default Claude chat button.

On the AI context page, describe a task and prepare the context. **Open in Claude
Code (paid)** opens `https://claude.ai/code` with the entire self-contained AI handoff
prefilled through Claude's official `prompt_url` parameter. When a GitHub
repository was captured, it is preselected. The self-contained handoff is used
even if the user is inspecting the base-only or task-only export tab.

Check **Open Claude automatically after I prepare a task** to reserve a tab
when clicking Prepare. The tab waits until preparation completes, then navigates
to Claude. Initial page loading and restoring saved context do not open tabs.
Preparation errors close the waiting tab. Blocked pop-ups, closed tabs, invalid
responses, and server failures leave the context available for another attempt
or for the existing copy/download actions. Changed requirements disable opening
the stale context until it is prepared again.

## Sign-in and Claude setup

Claude uses the current browser profile's session and owns the sign-in gate.
Contexa cannot inspect cross-origin Claude cookies or certify the user's login.
If signed out, the user signs in on Claude. If sign-in does not preserve the
prefill, return to Contexa and click Open again. Claude Code requires an eligible
Claude account, a GitHub connection, repository access, and a cloud environment;
those are configured on Claude. Contexa prefills the composer and does not press
Send or start work automatically. This opens Claude Code on the web, not a local
CLI or the general Claude chat product.

Official integration and setup reference:
https://code.claude.com/docs/en/web-quickstart#pre-fill-sessions

## Deployment

- Run `python manage.py migrate` to apply `0012_claude_launch`.
- Configure `BACKEND_BASE_URL` to the public HTTPS backend origin. Localhost is
  rejected with a useful error because Claude cannot reliably fetch its prompt.
- Keep the existing `FIELD_ENCRYPTION_KEY` configured: prompt copies are encrypted
  in the database, using the same encryption infrastructure as saved connections.
- No broad CORS changes are necessary. Only the signed public prompt endpoint
  allows `https://claude.ai`. Account and context APIs keep existing CORS rules.
- Schedule `python manage.py purge_claude_handoffs` every 15 minutes for physical
  deletion during idle periods. New launches also purge expired records. Access
  expires independently, even if cleanup has not run.

## Access and privacy

An authenticated, snapshot-owning user creates a link. It contains a signed,
15-minute capability to one encrypted prompt, never a Contexa auth token or the
source code itself. Anyone holding that specific capability can retrieve the
prompt until expiry or revocation; treat it as sensitive and do not log its query
string. The endpoint returns UTF-8 plain text with `no-store`, `no-referrer`, and
`noindex` headers. It deliberately permits retries so login or page refresh can
finish the handoff. Launches are limited to 20 active links per user, rate limited,
and bounded to a 1 MB handoff. Known credential patterns are redacted again.

**Revoke handoff link** deletes the current capability. Deleting the snapshot
also removes its launches. Revocation cannot erase a prompt already fetched by
Claude. There is no account connection, API key entry, browser extension,
clipboard permission, or prompt truncation required for this flow.

## Verification

Backend tests cover long prompts, encryption, owner isolation, missing/tampered
capabilities, expiry, revocation, snapshot deletion, input limits, local setup,
and CORS isolation. Frontend tests cover synchronous popup reservation, full
handoff selection, automatic launch after preparation, stale output blocking,
failures, revocation, destination validation, and navigation cleanup.

Live acceptance: in a browser already signed in to Claude with Code configured,
prepare a task, open it, verify the repository and complete prompt, then send it
manually. Repeat signed out, finish sign-in, and reopen if needed. Verify a
handoff larger than a typical URL (for example 10,000 tokens), blocked pop-ups,
and expired/revoked links. Automated tests do not authenticate a Claude account
or establish that Claude's current UI has loaded the prompt.
