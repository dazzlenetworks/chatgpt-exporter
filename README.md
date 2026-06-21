# ChatGPT Exporter

A small browser-console script that exports the currently open ChatGPT conversation to a Markdown file.

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

## Notes and limitations

- This is a browser-console utility, not a packaged extension or npm module.
- It depends on the current ChatGPT web UI structure, so it may need updates if the site changes.
- Export fidelity is intentionally simple and may not perfectly preserve all formatting.
- Review exported files before sharing them, especially if chats contain sensitive information.

## References

- Export Your ChatGPT Chats to Markdown & PDF  
  https://dev.to/rashidazarang/export-your-chatgpt-conversations-to-markdown-pdf-cfj

## Roadmap

- Improve formatting preservation in exported chats
- Better handling for code blocks, lists, and images
- Possibly turn it into a browser extension

## License

MIT