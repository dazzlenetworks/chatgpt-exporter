## 1. Purpose
Improve the export metadata and default download filename in `chatgpt-export.js` so exports are easier to identify later. Specifically, the goal was to replace the generic date-only filename with a timestamped filename that also includes the current chat title, and to make the exported markdown header reflect that title and show a real date/time value.

## 2. Context
This project is a browser-console snippet for exporting a ChatGPT conversation to Markdown. The README explicitly called out “Improve default filename of export” as future work. The existing script used a hardcoded document title in the markdown body and downloaded files as `chatgpt_export_YYYY-MM-DD.md`, which was functional but not very descriptive when saving multiple chats.

The user also wanted to keep the internal markdown H1 title unchanged while improving only the filename and header metadata.

## 3. Actions Taken
- Modified `chatgpt-export.js`
- Read and ingested `readme.md` and `chatgpt-export.js`
- Added `formatFilenameTimestamp(date)` to generate timestamps in `YYYY-MMdd-HHmm`
- Added `sanitizeFilenamePart(value)` to remove invalid filename characters and normalize whitespace
- Added `getChatTitle()` to derive the chat title from `document.title` with a fallback to `Untitled chat`
- Added `formatDateTime(date)` to generate `MM/DD/YYYY HH:mm` for exported metadata
- Updated download naming from a generic date-based filename to:
  - `YYYY-MMdd-HHmm ChatGPT export - {chat title}.md`
- Updated exported markdown header metadata to include:
  - `**Title:** {chat title}`
  - `**Date/Time:** {formatted local date/time}`
  - `**Source:** {url}`
- Left the markdown document H1/title unchanged as requested
- Performed a small indentation cleanup pass after formatting drift was noticed

No new dependencies, packages, or external libraries were introduced.

## 4. Key Decisions
- Used `document.title` for the chat name because it is simple, available in the browser console context, and likely the most stable source for the visible conversation title without adding brittle DOM selectors.
- Sanitized the chat title before using it in the filename to avoid invalid filesystem characters on Windows and other platforms.
- Used a fallback title of `Untitled chat` when `document.title` is missing or just `ChatGPT`, preventing empty or unhelpful filenames.
- Kept the markdown H1 as `ChatGPT Conversation Export` because the user explicitly said not to change the document title itself.
- Added a separate date/time formatter instead of overloading the existing date formatter so filename timestamping and display formatting remain independent and easier to maintain.

## 5. Behavior Changes
Before:
- Download filename was `chatgpt_export_YYYY-MM-DD.md`
- Export header showed only a date in ISO-style format
- Export header did not include the chat title

Now:
- Download filename is `YYYY-MMdd-HHmm ChatGPT export - {chat title}.md`
- Chat title is pulled from the current page title and sanitized for safe file naming
- Export header includes `Title`, `Date/Time`, and `Source`
- `Date/Time` is shown in `MM/DD/YYYY HH:mm`

## 6. Risks / Tradeoffs
- `document.title` is assumed to match the actual conversation title. If ChatGPT changes how page titles are set, the filename may become less accurate.
- The sanitization is intentionally simple; it removes invalid filename characters but does not handle every edge case (for example, very long titles).
- The script currently uses local browser time for both the displayed date/time and filename timestamp, which is usually desirable for users but less standardized than UTC.
- Some indentation/formatting drift happened during iterative edits, so the file may benefit from one final manual formatting pass if style consistency matters.

## 7. Next Steps
- Validate the title behavior on a few different ChatGPT pages (normal chat, untitled/new chat, shared links if relevant)
- Consider truncating very long chat titles in filenames to avoid path-length issues
- Optionally align the markdown H1 with the chat title if that becomes desirable later
- Review the image placeholder behavior in `extractMessageText()`; it currently appends placeholders rather than replacing image locations in-place
- If the script grows further, consider extracting export metadata generation into a dedicated helper for readability
