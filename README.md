# ChatGPT Exporter

A small browser-console script that exports the currently open ChatGPT conversation to a Markdown file.

## Why this exists

This project is meant to be a lightweight, no-install way to get a ChatGPT conversation out of the browser and into a portable Markdown file.

It is useful when you want to:
- keep a local copy of a conversation
- clean up and archive research or notes
- move chat content into a docs, notes, or writing workflow
- avoid needing an extension, package, or external service

## What it does


- reads the conversation currently visible in ChatGPT
- extracts user and assistant messages
- builds a Markdown document with basic metadata
- downloads the result as a `.md` file

## Usage

1. Open a ChatGPT conversation in your browser.
2. Open browser developer tools.
3. Paste the contents of `chatgpt-export.js` into the console.
4. Run it.
5. A Markdown file will be downloaded automatically.

## Files

- `chatgpt-export.js` - main export script
- `templates/template.md` - reference template for the Markdown output format
- `samples/2026-0621-0304 ChatGPT export - Lorem Ipsum Text.md` - curated sample export showing realistic current output

## Example output

See:
- `samples/2026-0621-0304 ChatGPT export - Lorem Ipsum Text.md`

This sample shows both the current strengths of the exporter and a few known rough edges in more advanced formatting cases.

## Privacy and safety

- The script runs locally in your browser console.
- It reads the conversation currently open in ChatGPT and downloads a Markdown file to your machine.
- It does not require a server, package install, or external API.
- Review exported files before sharing them, especially if chats contain sensitive or private information.

## Limitations

This project is intentionally lightweight.

It currently handles ordinary conversation content fairly well, including:
- headings
- lists
- code blocks
- blockquotes
- inline emphasis and inline code

Some advanced content may still export imperfectly, including:
- tables
- task lists
- footnotes
- math
- Mermaid diagrams
- some rich UI-specific or rendered content

It also depends on the current ChatGPT web UI structure, so it may need updates if the site changes.


## References

- Export Your ChatGPT Chats to Markdown & PDF  
  https://dev.to/rashidazarang/export-your-chatgpt-conversations-to-markdown-pdf-cfj

## Roadmap

- Improve formatting preservation in exported chats
- Better handling for code blocks, lists, and images
- Possibly turn it into a browser extension

## License

MIT