/*
 * ChatGPT Exporter
 *
 * Paste this script into the browser console while viewing a ChatGPT
 * conversation page. It will extract visible conversation turns and download
 * them as a Markdown file.
 *
 * Notes:
 * - This script depends on the current ChatGPT page structure and may need
 *   updates if the UI changes.
 * - Export formatting is intentionally simple and may not perfectly preserve
 *   all rich text elements.
 * - Review exported files before sharing if the conversation contains
 *   sensitive information.
 */
(() => {
    function formatCreatedFrontmatter(date = new Date()) {
        const month = date.getMonth() + 1;
        const day = date.getDate();
        const year = date.getFullYear();
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');

        return `${month}/${day}/${year} ${hours}:${minutes}`;
    }


    function formatFilenameTimestamp(date = new Date()) {

        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');

        return `${year}-${month}${day}-${hours}${minutes}`;
    }

    function escapeYamlString(value) {
        return String(value ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    }

    function sanitizeFilenamePart(value) {

        return (value || '')
            .replace(/[<>:"/\\|?*]/g, '')
            .replace(/\s+/g, ' ')
            .trim()
            .replace(/[. ]+$/, '');
    }

    function getChatTitle() {
        const pageTitle = sanitizeFilenamePart(document.title);

        // Default page titles ChatGPT shows for an unnamed conversation: the
        // plain product name on desktop and the marketing tagline on mobile.
        // (sanitizeFilenamePart has already stripped the tagline's colon.)
        const isDefaultTitle =
            /^chatgpt$/i.test(pageTitle) ||
            /^chatgpt[\s:,-]+chat, work, create & code with ai$/i.test(pageTitle);

        // Return empty so the caller can fall back to the first user prompt
        // (named chats set a real page title; logged-out chats do not).
        if (!pageTitle || isDefaultTitle) {
            return '';
        }

        return pageTitle;
    }

    // When the page has no chat name (typically logged-out sessions), derive a
    // filename-friendly title from the opening user message instead of a
    // generic placeholder.
    function firstUserMessageTitle(turns) {
        for (const turn of turns) {
            const role =
                turn.getAttribute('data-message-author-role') ||
                turn.getAttribute('data-message-role');
            if (role !== 'user') continue;

            const content =
                turn.querySelector('[data-user-message-copy]') ||
                turn.querySelector('.markdown') ||
                turn.querySelector('.prose') ||
                turn;

            const text = (content.textContent || '').replace(/\s+/g, ' ').trim();
            if (!text) continue;

            const maxLen = 60;
            if (text.length <= maxLen) return sanitizeFilenamePart(text);

            // Trim to the last whole word within the limit.
            const clipped = text.slice(0, maxLen).replace(/\s+\S*$/, '').trim();
            return sanitizeFilenamePart(clipped || text.slice(0, maxLen));
        }

        return '';
    }

    function cleanText(text) {
        return text
            .replace(/\u200b/g, '') // zero-width chars
            .replace(/[^\S\n]+\n/g, '\n') // trailing spaces/tabs before line breaks
            .replace(/\n{3,}/g, '\n\n')
            .trim();
    }

    // Collapse insignificant whitespace (source line wraps and runs of spaces)
    // inside text nodes that carry real content, mirroring how the browser
    // renders inline text. Whitespace-only nodes are left untouched so block
    // separation is preserved, and <pre>/<code> subtrees are skipped so code
    // indentation and spacing survive intact.
    function normalizeWhitespace(node) {
        if (node.nodeType === Node.TEXT_NODE) {
            if (/\S/.test(node.textContent)) {
                node.textContent = node.textContent.replace(/\s+/g, ' ');
            }
            return;
        }

        if (node.nodeType !== Node.ELEMENT_NODE) return;

        const tag = node.tagName.toLowerCase();
        if (tag === 'pre' || tag === 'code') return;

        Array.from(node.childNodes).forEach(normalizeWhitespace);
    }

    function renderInline(node) {
        if (node.nodeType === Node.TEXT_NODE) {
            return node.textContent || '';
        }

        if (node.nodeType !== Node.ELEMENT_NODE) {
            return '';
        }

        const tag = node.tagName.toLowerCase();
        const children = Array.from(node.childNodes).map(renderInline).join('');

        if (tag === 'br') return '\n';
        if (tag === 'strong' || tag === 'b') return children ? `**${children}**` : '';
        if (tag === 'em' || tag === 'i') return children ? `*${children}*` : '';
        if (tag === 'code') return children;
        if (tag === 'a') return renderLink(node, children);
        if (tag === 'p') return children ? `${children}\n\n` : '';

        return children;
    }

    // Render an anchor as Markdown, keeping the URL that the surrounding text
    // is citing. ChatGPT's inline source citations are anchors too, so without
    // this the export keeps the site name and silently loses the link.
    function renderLink(node, children) {
        const rawHref = (node.getAttribute('href') || '').trim();
        const label = children.replace(/\s+/g, ' ').trim();

        // Script and placeholder targets are interface wiring, not references.
        if (!rawHref || /^(javascript:|#)/i.test(rawHref)) return children;

        // The href property resolves relative targets against the page, so a
        // site-relative link exports as something a reader can actually follow.
        const url = stripChatgptTracking(node.href || rawHref);

        // A bare URL as its own label is an autolink; [url](url) is just noise.
        if (!label || label === url || label === rawHref) return `<${url}>`;

        // Whitespace or parentheses in the target would end the link early.
        return `[${label}](${/[()\s]/.test(url) ? `<${url}>` : url})`;
    }

    // ChatGPT tags every citation it emits with utm_source=chatgpt.com. Drop
    // exactly that pair and nothing else: other tracking parameters in these
    // URLs belong to the destination site, and rewriting those would be
    // editing someone else's link rather than removing our own footprint.
    //
    // Done by splitting on the separators rather than through the URL API,
    // which would re-encode the parameters left behind.
    function stripChatgptTracking(url) {
        const tracker = 'utm_source=chatgpt.com';
        if (!url.includes(tracker)) return url;

        // Hold the fragment aside so query surgery cannot disturb it.
        const hashAt = url.indexOf('#');
        const hash = hashAt === -1 ? '' : url.slice(hashAt);
        const base = hashAt === -1 ? url : url.slice(0, hashAt);

        const queryAt = base.indexOf('?');
        if (queryAt === -1) return url;

        const kept = base
            .slice(queryAt + 1)
            .split('&')
            .filter(pair => pair !== tracker);

        // Drop the '?' too when the tracker was the only parameter.
        return base.slice(0, queryAt) + (kept.length ? `?${kept.join('&')}` : '') + hash;
    }


    // ChatGPT renders code inside a CodeMirror editor, which gives every line its
    // own <div> and leaves no newline characters in the text at all. renderInline
    // concatenates children, so read those lines directly or the whole block
    // collapses onto one line. The older <pre>/<code> markup is still handled,
    // because the mobile web app may still produce it.
    //
    // cleanText is deliberately not applied to the CodeMirror path: it collapses
    // runs of blank lines and trims trailing whitespace, both of which can be
    // meaningful inside a code block.
    function readCodeText(pre, codeEl) {
        const cmLines = pre.querySelectorAll('.cm-line');
        if (!cmLines.length) return cleanText(renderInline(codeEl || pre));

        return Array.from(cmLines)
            .map(line => (line.textContent || '').replace(/\u00a0/g, ' '))
            .join('\n')
            .replace(/^\n+|\n+$/g, '');
    }

    // The language used to ride on the <code> element as a language-* class.
    // CodeMirror blocks have no such class: the language is plain text in a header
    // above the editor, alongside the copy and edit controls. Strip the editor and
    // the controls and whatever remains is the label.
    function readCodeLanguage(pre, codeEl) {
        const className = codeEl?.className || '';
        const match = className.match(/language-([\w]+)/);
        if (match) return match[1];

        if (!pre.querySelector('.cm-editor')) return '';

        const header = pre.cloneNode(true);
        header.querySelectorAll('.cm-editor, button, svg').forEach(el => el.remove());
        const text = (header.textContent || '').replace(/\s+/g, ' ').trim();

        // A language tag is one short token. Anything longer means the header was
        // not found and we are looking at interface text, so take nothing.
        return /^[a-z0-9+#.-]{1,15}$/i.test(text) ? text.toLowerCase() : '';
    }

    function extractCodeBlocks(container) {
        container.querySelectorAll('pre').forEach(pre => {
            const codeEl = pre.querySelector('code');
            const code = readCodeText(pre, codeEl);
            const lang = readCodeLanguage(pre, codeEl);

            // Use a fence longer than the longest run of backticks inside the
            // code so embedded fences (e.g. a Markdown sample containing its
            // own code block) don't terminate the block early.
            const longestRun = (code.match(/`+/g) || [])
                .reduce((max, run) => Math.max(max, run.length), 0);
            const fence = '`'.repeat(Math.max(3, longestRun + 1));

            const replacement = `\n${fence}${lang}\n${code}\n${fence}\n`;
            pre.replaceWith(replacement);
        });

        return container;
    }

    function replaceElementWithMarkdown(element, markdown) {
        element.replaceWith(document.createTextNode(markdown));
    }

    function extractHorizontalRules(container) {
        container.querySelectorAll('hr').forEach(hr => {
            replaceElementWithMarkdown(hr, '\n---\n');
        });

        return container;
    }

    function extractHeadings(container) {
        container.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach(heading => {
            const level = Number(heading.tagName.charAt(1));
            const text = cleanText(renderInline(heading));
            if (!text) {
                heading.remove();
                return;
            }

            replaceElementWithMarkdown(heading, `\n${'#'.repeat(level)} ${text}\n`);
        });

        return container;
    }

    function extractInlineCode(container) {
        container.querySelectorAll('code').forEach(code => {
            if (code.closest('pre')) return;

            const text = cleanText(code.textContent || '');
            replaceElementWithMarkdown(code, text ? `\`${text}\`` : '');
        });

        return container;
    }


    function extractLists(container) {
        container.querySelectorAll('ul, ol').forEach(list => {
            if (list.parentElement?.closest('ul, ol')) return;

            const isOrdered = list.tagName.toLowerCase() === 'ol';
            const markdown = renderList(list, isOrdered ? 0 : 0);
            replaceElementWithMarkdown(list, `\n${markdown}\n`);
        });

        return container;
    }

    function renderList(list, depth = 0) {


        const isOrdered = list.tagName.toLowerCase() === 'ol';
        const items = Array.from(list.children).filter(child => child.tagName?.toLowerCase() === 'li');

        return items.map((item, index) => {
            const marker = isOrdered ? `${index + 1}. ` : '- ';
            const indent = '  '.repeat(depth);
            const childBlocks = [];
            const inlineParts = [];

            Array.from(item.childNodes).forEach(child => {
                if (child.nodeType === Node.TEXT_NODE) {
                    inlineParts.push(child.textContent || '');
                    return;
                }

                if (child.nodeType !== Node.ELEMENT_NODE) {
                    return;
                }

                const tag = child.tagName.toLowerCase();
                if (tag === 'ul' || tag === 'ol') {
                    childBlocks.push(renderList(child, depth + 1));
                } else if (tag === 'p') {
                    inlineParts.push(cleanText(renderInline(child)));
                } else {
                    inlineParts.push(renderInline(child));
                }

            });

            // Join with no separator: text nodes already carry their own
            // spacing, so a separator would add stray spaces where inline
            // markup or streaming markers split the text (e.g. "8: 00").
            const firstLine = cleanText(inlineParts.join(''));
            const lines = [];

            if (firstLine) {
                const splitLines = firstLine.split('\n');
                lines.push(`${indent}${marker}${splitLines[0]}`);
                splitLines.slice(1).forEach(line => {
                    lines.push(`${indent}  ${line}`);
                });
            } else {
                lines.push(`${indent}${marker}`.trimEnd());
            }

            childBlocks.forEach(block => {
                lines.push(block);
            });

            return lines.join('\n');
        }).join('\n');
    }


    function stripNoise(container) {
        // Remove common interface elements that should not appear in exports.
        container.querySelectorAll([
            'button',
            'svg',
            'form',
            'nav',
            '[aria-label="Copy"]'
        ].join(',')).forEach(el => el.remove());

        // Remove button-like wrappers only when they do not contain meaningful text.
        container.querySelectorAll('[role="button"]').forEach(el => {
            const text = cleanText(el.innerText || '');
            if (!text) {
                el.remove();
            }
        });

        return container;
    }

    function extractBlockquotes(container) {
        container.querySelectorAll('blockquote').forEach(blockquote => {
            const text = cleanText(renderInline(blockquote));
            if (!text) {
                blockquote.remove();
                return;
            }

            const quoted = text
                .split('\n')
                .map(line => `> ${line}`)
                .join('\n');

            replaceElementWithMarkdown(blockquote, `\n${quoted}\n`);
        });

        return container;
    }

    // Runs before the block extractors so every renderInline caller sees the
    // same resolved tree; images inside headings, lists and blockquotes used to
    // vanish silently because only the final pass replaced them.
    function extractImages(container) {
        container.querySelectorAll('img, canvas').forEach(el => {
            // An image inside a link is decorative in ChatGPT's inline
            // citations — the source's favicon beside its name — so a
            // placeholder there would only clutter the link label.
            if (el.closest('a')) {
                el.remove();
                return;
            }

            // Elsewhere the marker stays inline, where the image appeared,
            // instead of collecting at the end.
            replaceElementWithMarkdown(el, '[Image]');
        });

        return container;
    }


    function extractMessageText(container) {
        if (!container) return '';

        const processed = container.cloneNode(true);
        normalizeWhitespace(processed);
        extractCodeBlocks(processed);
        stripNoise(processed);
        extractImages(processed);
        extractHorizontalRules(processed);
        extractHeadings(processed);
        extractInlineCode(processed);
        extractLists(processed);
        extractBlockquotes(processed);

        return cleanText(renderInline(processed));
    }



    // Conversation turns are identified by ChatGPT's role attribute. The
    // desktop site uses `data-message-author-role`; the mobile web app uses
    // `data-message-role`. Support both so exports work across layouts.
    function findTurns() {
        return document.querySelectorAll('[data-message-author-role], [data-message-role]');
    }

    function downloadFile(filename, text, mimeType) {
        const blob = new Blob([text], { type: mimeType });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = filename;

        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    }

    // When the conversation began, which the page states nowhere else: there is no
    // date in any DOM attribute, and the per-message ids are random UUIDv4.
    //
    // ChatGPT's conversation ids are UUIDv8 carrying the creation time as Unix
    // seconds in their first 32 bits. Confirmed on two conversations four months
    // apart, and against the timestamp ChatGPT itself shows in a message's menu.
    //
    // The format is inferred rather than documented, so every part of it is checked
    // before the value is used. A wrong date stated confidently is worse than an
    // absent one, so anything unexpected returns null and the field is left out.
    function conversationStarted(pathname = window.location.pathname) {
        const id = pathname.match(
            /\/c\/([0-9a-f]{8})-[0-9a-f]{4}-([0-9a-f])[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}/i
        );
        if (!id) return null;

        // Version nibble 8 marks a custom UUID. A v4 id is random and would decode
        // to an arbitrary date rather than to nothing, so this check is what stops
        // the whole idea producing plausible nonsense.
        if (id[2] !== '8') return null;

        const started = new Date(parseInt(id[1], 16) * 1000);
        const earliest = Date.UTC(2022, 0, 1);

        // Before ChatGPT existed, or in the future, means the assumption is wrong.
        if (!(started.getTime() > earliest && started.getTime() <= Date.now())) return null;

        return started;
    }

    function buildExportName(extension, now = new Date()) {
        const chatTitle =
            getChatTitle() || firstUserMessageTitle(findTurns()) || 'Untitled chat';

        return `${formatFilenameTimestamp(now)} ChatGPT export - ${chatTitle}.${extension}`;
    }

    // The smallest element containing every turn. Deliberately computed rather than
    // matched by id or class: it is derived from the same attribute the exporter
    // already depends on, so it adds no new way for ChatGPT's markup to break this.
    // Picking a node by hand is not reproducible either — two dumps taken minutes
    // apart rooted at different elements.
    function findConversationRoot() {
        const turns = findTurns();
        if (!turns.length) return null;

        let root = turns[0];
        turns.forEach(turn => {
            while (root && !root.contains(turn)) root = root.parentElement;
        });

        return root;
    }

    // Exports the conversation markup itself, for whoever has to repair this script
    // after ChatGPT changes its UI. Every fix so far needed the real DOM, produced
    // by hand from the inspector each time.
    function exportHtml() {
        const root = findConversationRoot();

        if (!root) {
            console.warn('No conversation turns were found. ChatGPT may have changed its page structure.');
            return;
        }

        const clone = root.cloneNode(true);

        // `script` can carry embedded JSON about the account, and is noise for
        // selector work. The rest is defensive: if the computed root ever climbs
        // higher than the thread, these are the sidebar and the chat-history list,
        // which name other conversations.
        clone.querySelectorAll('script, nav, aside, a[href^="/c/"]').forEach(el => el.remove());

        // A charset declaration so the file survives being opened later, and a
        // provenance comment so a folder of these can be told apart.
        const html = [
            '<!DOCTYPE html>',
            '<meta charset="utf-8">',
            `<!-- ChatGPT conversation markup, exported ${formatCreatedFrontmatter()} from ${window.location.href} -->`,
            clone.outerHTML
        ].join('\n');

        downloadFile(buildExportName('html'), html, 'text/html');
        console.log('DOM export complete.');
    }

    function exportMarkdown() {
        const turns = findTurns();
        const lines = [];

        const title = 'ChatGPT Conversation Export';
        const now = new Date();
        const created = formatCreatedFrontmatter(now);

        const chatTitle =
            getChatTitle() || firstUserMessageTitle(turns) || 'Untitled chat';
        const url = window.location.href;

        if (!turns.length) {
            console.warn('No conversation turns were found. ChatGPT may have changed its page structure.');
            return;
        }

        const started = conversationStarted();

        lines.push('---');
        lines.push(`created: ${created}`);

        // Kept separate from `created` rather than replacing it: one says when the
        // export ran, the other when the conversation began, and a reader has to be
        // able to tell them apart. Absent entirely when it cannot be established,
        // which is every logged-out conversation, since those have no id.
        if (started) lines.push(`conversation_started: ${formatCreatedFrontmatter(started)}`);

        lines.push(`title: "${escapeYamlString(chatTitle)}"`);
        lines.push(`source: "${escapeYamlString(url)}"`);
        lines.push('---');
        lines.push('');
        lines.push(`# ${title}`);
        lines.push('');
        lines.push('---');
        lines.push('');

        turns.forEach(turn => {
            const role =
                turn.getAttribute('data-message-author-role') ||
                turn.getAttribute('data-message-role');

            let sender = 'Unknown';
            if (role === 'user') sender = 'User Prompt';
            if (role === 'assistant') sender = 'ChatGPT';

            // Try likely message body containers, covering both the desktop site
            // (.markdown / .prose) and the mobile web app (data-* markers).
            const content =
                turn.querySelector('[data-assistant-markdown]') ||
                turn.querySelector('[data-user-message-copy]') ||
                turn.querySelector('.markdown') ||
                turn.querySelector('.prose') ||
                turn.querySelector('div');

            const text = extractMessageText(content);

            if (!text) return;

            lines.push(`## ${sender}\n`);
            lines.push(text);
            lines.push('\n---\n');
        });

        const markdown = lines.join('\n').trim();

        downloadFile(buildExportName('md', now), markdown, 'text/markdown');

        console.log('Export complete.');
    }

    // How this file is being run decides what happens now. Pasted into a console
    // it is a one-shot command, so it exports. Loaded by a userscript manager it
    // runs on every page view, where exporting unasked would be wrong — so it
    // registers a command and waits.
    const PANEL_ID = 'chatgpt-exporter-panel';

    // A floating panel rather than only a menu entry, because the export is about
    // the conversation in front of you and the control belongs beside it. Mid-right:
    // ChatGPT uses the bottom of the viewport for its own scroll and composer
    // controls, so anchoring there invites a collision on every redesign.
    function buildPanel() {
        // Colours resolve through ChatGPT's own theme variables, so the panel
        // follows light and dark without this script tracking either. The literal
        // after each comma is what shows if those variable names change.
        const surface = 'var(--token-main-surface-primary,#ffffff)';
        const border = 'var(--token-border-light,rgba(127,127,127,.4))';
        const text = 'var(--token-text-primary,#0d0d0d)';
        const muted = 'var(--token-text-secondary,#5d5d5d)';

        const panel = document.createElement('div');
        panel.id = PANEL_ID;

        // One card rather than loose buttons: the heading carries the verb, so each
        // control only has to name its format.
        panel.style.cssText = [
            'position:fixed',
            'right:12px',
            'top:50%',
            'transform:translateY(-50%)',
            'z-index:2147483647',
            'display:flex',
            'flex-direction:column',
            'gap:4px',
            'padding:8px',
            'border-radius:10px',
            `border:1px solid ${border}`,
            `background:${surface}`,
            'box-shadow:0 2px 8px rgba(0,0,0,.25)',
            'font:500 12px/1.2 ui-sans-serif,system-ui,sans-serif'
        ].join(';');

        const heading = document.createElement('div');
        heading.textContent = 'Export';
        heading.style.cssText = [
            'padding:0 2px',
            'font-size:11px',
            'font-weight:600',
            'letter-spacing:.04em',
            'text-transform:uppercase',
            `color:${muted}`,
            'cursor:default',
            'user-select:none'
        ].join(';');
        panel.appendChild(heading);

        // The panel's own state, so its presence answers "did the script load?" and
        // this line answers "has it got anything to work with?". Without it the two
        // questions have the same answer — nothing on screen — and a failed load is
        // indistinguishable from an empty page.
        const status = document.createElement('div');
        status.setAttribute('data-exporter-status', '');
        status.style.cssText = [
            'padding:0 2px 4px',
            'font-size:11px',
            'font-weight:400',
            `color:${muted}`,
            'cursor:default',
            'user-select:none'
        ].join(';');
        panel.appendChild(status);

        [
            ['Markdown', exportMarkdown],
            ['HTML', exportHtml]
        ].forEach(([label, handler]) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.textContent = label;
            button.style.cssText = [
                'padding:5px 10px',
                'border-radius:6px',
                'cursor:pointer',
                'white-space:nowrap',
                'text-align:left',
                'font:inherit',
                `border:1px solid ${border}`,
                'background:transparent',
                `color:${text}`
            ].join(';');

            button.addEventListener('click', handler);
            panel.appendChild(button);
        });

        return panel;
    }

    // Reflect the conversation in the panel: how many turns would be exported, and
    // whether there is anything to export at all.
    function updatePanelState(panel) {
        const count = findTurns().length;
        const status = panel.querySelector('[data-exporter-status]');
        const label = count ? `${count} turn${count === 1 ? '' : 's'}` : 'No conversation';

        // Only write when it actually changed. This runs from a MutationObserver
        // watching the whole subtree, and replacing the text node is itself a
        // mutation — assigning unconditionally would retrigger the observer and
        // leave the panel updating itself forever.
        if (status.textContent !== label) status.textContent = label;

        panel.querySelectorAll('button').forEach(button => {
            button.disabled = !count;
            button.style.opacity = count ? '1' : '.45';
            button.style.cursor = count ? 'pointer' : 'default';
        });
    }

    // ChatGPT is a single-page app: the thread is replaced when you move between
    // conversations, so this runs again on mutation rather than once at load.
    //
    // The panel stays put across all of that, including where there is no
    // conversation. Its presence is how anyone can tell the script is loaded, so
    // removing it exactly when there is nothing to export would hide the panel in
    // the one case where the user most needs to know it is there.
    function syncPanel() {
        let panel = document.getElementById(PANEL_ID);

        // Appended to body, never into the thread, which does not survive
        // navigation.
        if (!panel) {
            panel = buildPanel();
            document.body.appendChild(panel);
        }

        updatePanelState(panel);
    }

    function installPanel() {
        syncPanel();

        // Coalesce bursts of mutation — streaming a reply fires these continuously,
        // and the check only needs to run once things settle.
        let pending = 0;
        new MutationObserver(() => {
            clearTimeout(pending);
            pending = setTimeout(syncPanel, 300);
        }).observe(document.body, { childList: true, subtree: true });
    }

    // The panel is the interface in both modes. Under a userscript manager it is
    // the only one, so the menu commands stay as a fallback for the case where a
    // future ChatGPT stylesheet hides the panel. Pasted into a console the panel is
    // still better than exporting immediately: both artifacts become available,
    // where a one-shot paste could only ever produce one of them.
    if (typeof GM_registerMenuCommand === 'function') {
        GM_registerMenuCommand('Export conversation to Markdown', exportMarkdown);
        GM_registerMenuCommand('Export conversation markup as HTML', exportHtml);
    }

    installPanel();
})();