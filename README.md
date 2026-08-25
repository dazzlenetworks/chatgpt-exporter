# ChatGPT Exporter

A small browser script that exports the currently open ChatGPT conversation, either as a Markdown file or as the conversation's own HTML markup.

## Why this exists

This project is meant to be a lightweight, no-install way to get a ChatGPT conversation out of the browser and into a portable Markdown file.

It is useful when you want to:
- keep a local copy of a conversation
- clean up and archive research or notes
- move chat content into a docs, notes, or writing workflow
- avoid needing an extension, package, or external service

## What it does

- adds a small vertical rail to the right of the page, showing how many conversation turns it can see
- reads the conversation currently visible in ChatGPT when you press one of its buttons
- **Preview** (eye) shows the Markdown on screen without saving anything
- **.md** extracts the user and assistant messages and downloads a Markdown file with basic metadata
- **.html** downloads the conversation's own markup instead, which is what you want when the exporter needs fixing

Both files are named for the same timestamp and chat title, so a pair exported together sorts side by side.

### The Markdown frontmatter

Each Markdown export opens with a short YAML block:

| Field | Meaning |
| --- | --- |
| `created` | When the export was made |
| `conversation_started` | When the chat itself began |
| `title` | The conversation's title, or its opening words where it has none |
| `source` | The page the export was taken from |

**`conversation_started` is frequently absent, and that is not a fault.** It is derived from the conversation's own id, which ChatGPT only assigns to a signed-in chat. Exporting a logged-out conversation leaves nothing to derive it from, so the field is left out rather than filled with a guess — an omitted date is honest, whereas a plausible wrong one is not.

## Usage

1. Open a ChatGPT conversation in your browser.
2. Open browser developer tools.
3. Paste the contents of `chatgpt-export.js` into the console and run it.
4. The **ChatGPT Exporter** rail appears at the right of the page.
5. Press the eye to read the Markdown first, or **.md** / **.html** to download it straight away.

**Preview** opens the export on screen and writes nothing to disk. It shows the document exactly as the Markdown export would write it — the same text, from the same code — along with the filename it would be saved under.

The preview carries its own **.md** and **.html** buttons, so a conversation can be read and then exported without closing it. Both save under the filename shown in the preview's own header, and the preview stays open afterwards so the other format is still one click away. Dismiss it with **Close**, the `Escape` key, or a click outside it.

### Reading the rail

The rail carries its name, a status dot, and three buttons.

**The green dot reports the script, not the conversation**, so it is always lit. It means the exporter loaded and is running on this page. Beside it, a number appears giving the count of conversation turns it can currently see — and no number at all when there is no conversation.

The three buttons are **disabled and dimmed whenever there is nothing to export**, and become active as soon as there are turns.

The rail stays put as you move between conversations, and remains visible even where there is nothing to export — so that "loaded and waiting" never looks the same as "did not load at all". If the rail is missing entirely, the script is not running.

### Running it from a userscript manager

The script also works unmodified under Violentmonkey, Tampermonkey or similar. Loaded that way it does not export on its own — it paints the same rail, and additionally registers all three actions as menu commands in case a future ChatGPT stylesheet ever hides the rail.

It does not ship with a userscript header; add `@match https://chatgpt.com/*` yourself if you want that.

## Files

- `chatgpt-export.js` - main export script
- `templates/template.md` - reference template for the Markdown output format
- `samples/2026-0621-0304 ChatGPT export - Lorem Ipsum Text.md` - curated sample export showing realistic current output

## Example output

See:
- `samples/2026-0621-0304 ChatGPT export - Lorem Ipsum Text.md`

This sample shows both the current strengths of the exporter and a few known rough edges in more advanced formatting cases.

## Privacy and safety

- The script runs locally in your browser. It does not require a server, package install, or external API, and it sends nothing anywhere — every file it produces is a download to your own machine.
- Review exported files before sharing them, especially if chats contain sensitive or private information.

### What the HTML export captures

Worth knowing precisely, because raw markup can carry more than it appears to.

It captures **the smallest element that contains every message in the conversation, and nothing above it**. That element is found by walking up from the messages themselves rather than by matching a fixed selector, so it does not drift into the surrounding page when ChatGPT changes its layout.

From within that element it then removes:

- `script` elements, which can carry embedded JSON about your account
- `nav` and `aside` elements, and any link to another conversation

Those removals are a safety net rather than the main defence: the sidebar, your account menu and your other chats all sit outside the captured element to begin with.

It does not capture the page's stylesheets, so the saved file will not look like ChatGPT. It is meant for reading markup, not for reading the conversation — use the Markdown export for that.

## Limitations

This project is intentionally lightweight.

It currently handles ordinary conversation content fairly well, including:
- headings
- lists
- code blocks
- blockquotes
- inline emphasis and inline code
- links, including the inline source citations ChatGPT adds when it searches
  the web — these export as ordinary Markdown links to the cited page
- inline entity references — the films, books, people and similar that ChatGPT
  renders as info-card buttons rather than links — these export as their plain name

Some advanced content may still export imperfectly, including:
- tables
- task lists
- footnotes
- math
- Mermaid diagrams
- some rich UI-specific or rendered content

It works with both the desktop site and the mobile web app layouts. Because it still depends on the current ChatGPT web UI structure, it may need updates if the site changes.

## References

- Export Your ChatGPT Chats to Markdown & PDF  
  https://dev.to/rashidazarang/export-your-chatgpt-conversations-to-markdown-pdf-cfj

## Roadmap

- Improve formatting preservation in exported chats
- Better handling for tables, images, and other rich content
- Package it for one-click installation

## License

MIT