# Job Helper

Premium zinc-themed Next.js workspace with Google OAuth, Prisma, and first-pass
automatic job tracking from uploaded screenshots.

## Setup

1. Copy `.env.example` to `.env`.
2. Fill in `NEXTAUTH_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `DATABASE_URL`, `OPENAI_API_KEY`, and `JOB_HELPER_INGEST_SECRET`.
3. Create and apply the Prisma migrations against Railway:

```bash
npx prisma migrate dev
```

4. In Google Cloud, add this redirect URI:

```text
http://localhost:3000/api/auth/callback/google
[And your Railway site]
```

5. Start the app:

```bash
npm run dev
```

6. Download Hammerspoon and put the following in `~/.hammerspoon/init.lua`:
```
hs.alert.show("Hammerspoon loaded fwahhh")

local JOB_HELPER_SITE = "http://localhost:3000"
local INGEST_ENDPOINT = JOB_HELPER_SITE .. "/api/job-applications/ingest"
local DASHBOARD_URL = JOB_HELPER_SITE .. "/dashboard?ingested=1"
local JOB_HELPER_SECRET = "replace-with-your-JOB_HELPER_INGEST_SECRET"
local JOB_HELPER_USER_EMAIL = "replace-with-your-google-email@example.com"

local function shellQuote(value)
  return "'" .. tostring(value):gsub("'", "'\\''") .. "'"
end

local function logAndAlert(message)
  print(message)
  hs.alert.show(message)
end

hs.hotkey.bind({"cmd", "shift"}, "S", function()
  hs.alert.show("Hammerspoon taking screenshot fwahhh")

  local path = "/tmp/hs-job-helper-shot.png"

  if not hs.screenRecordingState() then
    hs.screenRecordingState(true)
    logAndAlert("Enable Screen Recording for Hammerspoon, then try again")
    return
  end

  -- screenshot
  local screenshotCommand = "/usr/sbin/screencapture -x " .. shellQuote(path) .. " 2>&1"
  local screenshotOutput, screenshotOk, _, screenshotCode = hs.execute(screenshotCommand)
  if not screenshotOk then
    local detail = screenshotOutput and screenshotOutput:gsub("%s+$", "") or ""
    if detail == "" then
      detail = "exit code " .. tostring(screenshotCode)
    end

    logAndAlert("Screenshot failed: " .. detail)
    return
  end

  local canRestoreOriginalTab, originalTabIndex = hs.osascript.applescript([[
    tell application "Google Chrome"
      return active tab index of window 1
    end tell
  ]])

  local canRestoreOriginalWindow, originalWindowId = hs.osascript.applescript([[
    tell application "Google Chrome"
      return id of window 1
    end tell
  ]])

  local curlCommand = table.concat({
    "curl",
    "--silent",
    "--show-error",
    "--fail",
    "-H", shellQuote("X-Job-Helper-Secret: " .. JOB_HELPER_SECRET),
    "-H", shellQuote("X-Job-Helper-User-Email: " .. JOB_HELPER_USER_EMAIL),
    "-F", shellQuote("source=hammerspoon"),
    "-F", shellQuote("jobScreenshots=@" .. path .. ";type=image/png"),
    shellQuote(INGEST_ENDPOINT)
  }, " ") .. " 2>&1"
  local curlOutput, curlOk = hs.execute(curlCommand)

  if not curlOk then
    logAndAlert("Job Helper upload failed: " .. tostring(curlOutput):gsub("%s+$", ""))
    return
  end

  hs.alert.show("Job Helper saved the screenshot")

  local dashboardScriptOk = hs.osascript.applescript([[
    tell application "Google Chrome"
      activate
      set dashboardTab to missing value

      repeat with chromeWindow in windows
        repeat with tabRef in tabs of chromeWindow
          if URL of tabRef contains "]] .. JOB_HELPER_SITE .. [[/dashboard" then
            set dashboardTab to tabRef
            exit repeat
          end if
        end repeat

        if dashboardTab is not missing value then
          exit repeat
        end if
      end repeat

      if dashboardTab is missing value then
        make new window
        set URL of active tab of front window to "]] .. DASHBOARD_URL .. [["
      else
        set URL of dashboardTab to "]] .. DASHBOARD_URL .. [["
      end if
    end tell
  ]])

  if not dashboardScriptOk then
    hs.execute("open " .. shellQuote(DASHBOARD_URL))
    return
  end

  if canRestoreOriginalTab and canRestoreOriginalWindow then
    hs.osascript.applescript([[
    tell application "Google Chrome"
      set frontmost to true
      set front window to (first window whose id is ]] .. originalWindowId .. [[)
      set active tab index of front window to ]] .. originalTabIndex .. [[
    end tell
  ]])
  end

end)
```

## Notes

- `/` is the public sign-in landing page.
- `/dashboard` is server-protected and redirects to `/` when there is no session.
- Authentication route handlers live under `app/api/auth/[...nextauth]/route.ts`.
- Prisma uses PostgreSQL and is configured in [`prisma/schema.prisma`](/Users/Henry/Developer/job-helper/prisma/schema.prisma).
- Google users, accounts, and sessions are persisted in Postgres through the Prisma adapter.
- Uploading a screenshot on `/dashboard` stores the image under `public/uploads/job-screenshots/`, sends it to the OpenAI Responses API with a strict JSON schema, and creates `Company`, `JobApplicationScreenshot`, and `JobApplication` records.
- The Hammerspoon hotkey posts directly to `/api/job-applications/ingest`, so it needs `JOB_HELPER_INGEST_SECRET` in `.env` and the matching secret plus Google account email in `~/.hammerspoon/init.lua`.
- The shared ingestion endpoint accepts screenshots, structured page context, raw page text, or any combination. Hammerspoon currently sends screenshots; the Chrome extension sends both a screenshot and structured browser evidence.
- The default extraction model is `gpt-5-mini`; override it with `OPENAI_JOB_EXTRACTION_MODEL`.
