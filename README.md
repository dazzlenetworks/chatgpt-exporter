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

- reads the conversation currently visible in ChatGPT
- adds a small **Export** panel to the page, with a **Markdown** and an **HTML** button
- **Markdown** extracts the user and assistant messages and downloads a `.md` file with basic metadata
- **HTML** downloads the conversation's own markup instead, which is what you want when the exporter needs fixing

Both files are named for the same timestamp and chat title, so a pair exported together sorts side by side.

## Usage

1. Open a ChatGPT conversation in your browser.
2. Open browser developer tools.
3. Paste the contents of `chatgpt-export.js` into the console and run it.
4. The **Export** panel appears at the right of the page.
5. Click **Markdown** or **HTML**. The file downloads immediately.

The panel stays as you move between conversations, and disappears on pages that have no conversation on them.

### Running it from a userscript manager

The script also works unmodified under Violentmonkey, Tampermonkey or similar. Loaded that way it does not export on its own — it paints the same panel, and additionally registers both exports as menu commands in case a future ChatGPT stylesheet ever hides the panel.

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
- A preview of the Markdown before exporting it
- Package it for one-click installation

## License

MIT