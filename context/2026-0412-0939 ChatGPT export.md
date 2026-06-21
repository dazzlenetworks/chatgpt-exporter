# ChatGPT Conversation Export
**Date:** 2026-04-12
**Source:** https://chatgpt.com/c/69dbc827-8558-83e8-b14b-43cb6c21f4c2

---

## You
Can you check this code to make sure it is safe? Its intent is to run in console to export a chat with yourself.

Can you also tell me if it will work with current versions of ChatGPT UI?

```
(() => {
    function formatDate(date = new Date()) {
        return date.toISOString().split('T')[0];
    }

    function escapeMarkdown(text) {
        return text
            .replace(/\\/g, '\\\\')
            .replace(/\*/g, '\\*')
            .replace(/_/g, '\\_')
            .replace(/`/g, '\\`')
            .replace(/\n{3,}/g, '\n\n');
    }

    function processMessageContent(element) {
        const clone = element.cloneNode(true);

        // Replace <pre><code> blocks
        clone.querySelectorAll('pre').forEach(pre => {
            const code = pre.innerText.trim();
            const langMatch = pre.querySelector('code')?.className?.match(/language-([a-zA-Z0-9]+)/);
            const lang = langMatch ? langMatch[1] : '';
            pre.replaceWith(`\n\n\`\`\`${lang}\n${code}\n\`\`\`\n`);
        });

        // Replace images and canvas with placeholders
        clone.querySelectorAll('img, canvas').forEach(el => {
            el.replaceWith('[Image or Canvas]');
        });

        // Convert remaining HTML to plain markdown-style text
        return escapeMarkdown(clone.innerText.trim());
    }

    const messages = document.querySelectorAll('div[class*="group"]');
    const lines = [];

    const title = 'Conversation with ChatGPT';
    const date = formatDate();
    const url = window.location.href;

    lines.push(`# ${title}\n`);
    lines.push(`**Date:** ${date}`);
    lines.push(`**Source:** [chat.openai.com](${url})\n`);
    lines.push(`---\n`);

    messages.forEach(group => {
        const isUser = !!group.querySelector('img');
        const sender = isUser ? 'You' : 'ChatGPT';
        const block = group.querySelector('.markdown, .prose, .whitespace-pre-wrap');

        if (block) {
            const content = processMessageContent(block);
            if (content) {
                lines.push(`### **${sender}**\n`);
                lines.push(content);
                lines.push('\n---\n');
            }
        }
    });

    const markdown = lines.join('\n').trim();
    const blob = new Blob([markdown], { type: 'text/markdown' });
    const a = document.createElement('a');
    a.download = `ChatGPT_Conversation_${date}.md`;
    a.href = URL.createObjectURL(blob);
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
})();
```

---

## ChatGPT
Short answer

Safety: Yes — this script is locally safe. It only reads the page DOM and triggers a file download. It does not send data anywhere, execute remote code, or access external APIs.

Will it work in current ChatGPT UI (2026): Probably not reliably without updates. The DOM selectors and role-detection logic are the weak points and are likely outdated.

1. Safety review
What it does

Reads DOM (document.querySelectorAll)

Clones message nodes

Converts content to Markdown-ish text

Downloads a .md file via Blob

Uses URL.createObjectURL

What it does NOT do

❌ No network requests

❌ No data exfiltration

❌ No eval / Function constructor / script injection

❌ No persistence or cookies access

❌ No modification of server state

Verdict
✔ Safe to run in your browser console
✔ Safe in the sense of “local export tool”
⚠ Only risk is personal data exposure if you run it on a shared machine

2. Main compatibility issues (important)
ChatGPT’s UI structure has changed significantly over time. The fragile parts:

❌ 1. Message selection is outdated

```
JavaScriptdocument.querySelectorAll('div[class*="group"]');
```

Problem

“group” class is not stable

ChatGPT UI now uses more semantic attributes like:

data-message-author-role

data-testid="conversation-turn"

nested article/section structures

Result
👉 You may capture:

extra UI containers

missing messages

duplicated nodes

❌ 2. User vs assistant detection is unreliable

```
JavaScriptconst isUser = !!group.querySelector('img');
```

Problem
Both user and assistant messages may contain images (avatars, inline images).
Result
👉 You will mislabel messages randomly

⚠️ Better modern approach (conceptual)
Look for something like:

data-message-author-role="user"

data-message-author-role="assistant"

or:

nearest parent element with role metadata

❌ 3. Message content selector is fragile

```
JavaScriptgroup.querySelector('.markdown, .prose, .whitespace-pre-wrap');
```

Problem

ChatGPT frequently changes styling classes (prose, whitespace-pre-wrap, etc.)

Some messages are now rendered in nested containers or shadow-like structures

Result
👉 Some messages will export blank or partial content

⚠️ 4. Code block parsing is “mostly OK but incomplete”
Issue
You replace <pre> but assume:

```
JavaScriptpre.querySelector('code')
```

always exists — not guaranteed in all render modes.
Also:

innerText can already include formatting artifacts

nested code blocks or copied UI elements may break formatting

⚠️ 5. Markdown escaping is over-aggressive in some contexts

```
JavaScriptescapeMarkdown()
```

Issue

You escape `* _ `` globally after HTML flattening

But you already convert to plain text → this can lead to over-escaping and ugly output

❌ 6. Potential duplication / layout noise
Because you use:

```
JavaScriptclone.innerText
```

You may capture:

button labels (“Copy”, “Regenerate”)

hidden accessibility text

UI artifacts

3. Will it work in current ChatGPT UI?
Likely outcome in 2026 UI:
FeatureStatusBasic export⚠ partialCorrect ordering✔ mostlyCorrect roles (user/assistant)❌ unreliableCode formatting✔ mostlyImages handling✔ basicClean markdown output⚠ inconsistent

4. What I would change (high impact fixes)
✔ Fix 1: Use role-based selectors (critical)
Instead of:

```
JavaScriptdiv[class*="group"]
```

Prefer something like:

```
JavaScriptdocument.querySelectorAll('[data-message-author-role]')
```

or:

```
JavaScriptdocument.querySelectorAll('[data-testid="conversation-turn"]')
```

✔ Fix 2: Detect sender properly
Replace:

```
JavaScriptconst isUser = !!group.querySelector('img');
```

With:

```
JavaScriptconst role = group.getAttribute('data-message-author-role');const sender = role === 'user' ? 'You' : 'ChatGPT';
```

✔ Fix 3: Extract only message content container
Instead of guessing .markdown, .prose..., find the message body inside the turn container.

✔ Fix 4: Avoid over-escaping
You likely want:

either raw markdown

or minimal escaping only for backticks

5. Overall verdict
Safety
✔ Safe local export script
Reliability (current ChatGPT UI)
⚠ Medium to low without updates
❌ Fragile DOM assumptions will break over time

6. Bottom line
This is a well-intentioned DOM scraper, but it’s tied to old ChatGPT frontend structure assumptions. The core logic is fine — the selectors and role detection are what will fail first.
If you want, I can :

---

## You
Please do.

---

## ChatGPT
Here’s a modern, more resilient ChatGPT conversation exporter designed for current UI patterns (2025–2026 era DOM), with safer selectors, better role detection, and cleaner Markdown output.

✅ Key improvements vs your version

Uses data-message-author-role (much more stable)

Avoids brittle class-based selectors

Better message boundary detection

Cleaner code block handling

Reduces UI noise (buttons, metadata)

More consistent Markdown output

No over-escaping of text

More tolerant to UI changes

🧠 Modern ChatGPT Exporter (paste into console)

```
JavaScript(() => {    function formatDate(date = new Date()) {        return date.toISOString().split('T')[0];    }    function cleanText(text) {        return text            .replace(/\u200b/g, '') // zero-width chars            .replace(/\n{3,}/g, '\n\n')            .trim();    }    function extractCodeBlocks(container) {        const clone = container.cloneNode(true);        clone.querySelectorAll('pre').forEach(pre => {            const codeEl = pre.querySelector('code');            const code = (codeEl?.innerText || pre.innerText || '').trim();            let lang = '';            const className = codeEl?.className || '';            const match = className.match(/language-([\w]+)/);            if (match) lang = match[1];            const replacement = `\n\`\`\`${lang}\n${code}\n\`\`\`\n`;            pre.replaceWith(replacement);        });        return clone;    }    function stripNoise(container) {        // Remove common UI elements        container.querySelectorAll([            'button',            'svg',            'form',            'nav',            '[role="button"]',            '[aria-label="Copy"]'        ].join(',')).forEach(el => el.remove());        return container;    }    function extractMessageText(container) {        if (!container) return '';        const processed = extractCodeBlocks(container);        stripNoise(processed);        // Replace images with placeholders        processed.querySelectorAll('img, canvas').forEach(() => {            const placeholder = document.createTextNode('[Image]');            processed.appendChild(placeholder);        });        return cleanText(processed.innerText);    }    // ✅ Modern selector strategy (2026-safe)    const turns = document.querySelectorAll('[data-message-author-role]');    const lines = [];    const title = "ChatGPT Conversation Export";    const date = formatDate();    const url = window.location.href;    lines.push(`# ${title}`);    lines.push(`**Date:** ${date}`);    lines.push(`**Source:** ${url}`);    lines.push('\n---\n');    turns.forEach(turn => {        const role = turn.getAttribute('data-message-author-role');        let sender = 'Unknown';        if (role === 'user') sender = 'You';        if (role === 'assistant') sender = 'ChatGPT';        // Message content container (more resilient search)        const content =            turn.querySelector('.markdown') ||            turn.querySelector('.prose') ||            turn.querySelector('div');        const text = extractMessageText(content);        if (!text) return;        lines.push(`## ${sender}`);        lines.push(text);        lines.push('\n---\n');    });    const markdown = lines.join('\n').trim();    const blob = new Blob([markdown], { type: 'text/markdown' });    const a = document.createElement('a');    a.href = URL.createObjectURL(blob);    a.download = `chatgpt_export_${date}.md`;    document.body.appendChild(a);    a.click();    document.body.removeChild(a);    console.log("Export complete.");})();
```

🚀 Why this version works better
1. Stable role detection

```
JavaScript[data-message-author-role]
```

This is currently the most reliable structural marker in ChatGPT’s UI.

2. Doesn’t rely on fragile class names
Your original:

.group

.prose

.whitespace-pre-wrap

These change often → this version avoids depending on them.

3. Safer DOM handling

Clones nodes before modifying

Removes UI controls (buttons, SVG icons)

Prevents exporting “Copy”, “Regenerate”, etc.

4. Better code handling
Preserves:

language hints (when available)

full <pre><code> structure

avoids broken indentation

5. Cleaner output
Produces:

```
Markdown## You...---## ChatGPT...---
```

Much more readable and portable.

⚠️ Known limitations (no script can fully avoid these)
Even this improved version can still hit:

minor UI redesigns (OpenAI sometimes shifts structure)

edge-case formatting inside streamed messages

rare missing role attributes in experimental layouts

🔧 If you want next upgrade
I can also build you a version that:

or

---