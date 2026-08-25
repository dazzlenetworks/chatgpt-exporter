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


    // ChatGPT renders an inline "entity" reference — a film, book, person or
    // similar — as a button that opens a details dialog rather than as a link.
    // The visible name sits in a data-assistant-entity-name span, and the button
    // carries no URL, only a payload describing what to look up, so there is
    // nothing to link to: the reference is kept as its plain name. This must run
    // before stripNoise, which would otherwise remove the button as interface
    // chrome and take the name — and any surrounding emphasis — with it.
    function extractEntityReferences(container) {
        container.querySelectorAll('[data-assistant-entity-trigger]').forEach(button => {
            const nameEl = button.querySelector('[data-assistant-entity-name]') || button;
            const name = cleanText(nameEl.textContent || '');
            replaceElementWithMarkdown(button, name);
        });

        return container;
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
        extractEntityReferences(processed);
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
    function exportHtml(moment) {
        const root = findConversationRoot();

        if (!root) {
            console.warn('No conversation turns were found. ChatGPT may have changed its page structure.');
            return;
        }

        // Same guard as exportMarkdown: also used directly as a click handler.
        const now = usableMoment(moment) ? moment : new Date();
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
            `<!-- ChatGPT conversation markup, exported ${formatCreatedFrontmatter(now)} from ${window.location.href} -->`,
            clone.outerHTML
        ].join('\n');

        downloadFile(buildExportName('html', now), html, 'text/html');
        console.log('DOM export complete.');
    }

    // Builds the document without deciding what to do with it, so the preview shows
    // the export rather than a second rendering of the same conversation. Anything
    // that renders Markdown its own way will drift from what actually downloads, and
    // a preview you cannot trust is worse than none.
    //
    // Takes the moment as an argument so one export stamps its frontmatter and its
    // filename identically, rather than calling the clock twice.
    function buildMarkdown(now = new Date()) {
        const turns = findTurns();
        const lines = [];

        const title = 'ChatGPT Conversation Export';
        const created = formatCreatedFrontmatter(now);

        const chatTitle =
            getChatTitle() || firstUserMessageTitle(turns) || 'Untitled chat';
        const url = window.location.href;

        if (!turns.length) {
            console.warn('No conversation turns were found. ChatGPT may have changed its page structure.');
            return '';
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

        return lines.join('\n').trim();
    }

    // The moment is an argument so the preview can export under the same filename
    // it displayed, rather than deriving a fresh one that may have crossed a minute.
    //
    // Guarded rather than defaulted, because these are also click handlers: an
    // unguarded parameter would silently receive a MouseEvent. Duck-typed rather
    // than `instanceof Date`, which answers no for a date built in another realm or
    // before something replaced the global — both of which look exactly like the
    // caller passing nothing.
    function usableMoment(value) {
        return value && typeof value.getTime === 'function' && !isNaN(value.getTime());
    }

    function exportMarkdown(moment) {
        const now = usableMoment(moment) ? moment : new Date();
        const markdown = buildMarkdown(now);
        if (!markdown) return;

        downloadFile(buildExportName('md', now), markdown, 'text/markdown');

        console.log('Export complete.');
    }

    const PREVIEW_ID = 'chatgpt-exporter-preview';

    function closePreview() {
        const overlay = document.getElementById(PREVIEW_ID);
        if (overlay) overlay.remove();

        // Removed rather than hidden, so nothing of ours is left listening or
        // occupying the page once it is dismissed.
        document.removeEventListener('keydown', onPreviewKey);
    }

    function onPreviewKey(event) {
        if (event.key === 'Escape') closePreview();
    }

    // Shows exactly what a Markdown export would write, and the name it would write
    // it under, so the export can be checked before it lands in a folder.
    function previewMarkdown() {
        const now = new Date();
        const markdown = buildMarkdown(now);
        if (!markdown) return;

        // Never two.
        closePreview();

        // Shares the rail's palette rather than restating it, so the two cannot
        // drift into looking like different tools.
        const surface = SURFACE;
        const border = BORDER;
        const text = TEXT;
        const muted = MUTED;

        const backdrop = document.createElement('div');
        backdrop.id = PREVIEW_ID;
        backdrop.style.cssText = [
            'position:fixed',
            'inset:0',
            'z-index:2147483647',
            'display:flex',
            'align-items:center',
            'justify-content:center',
            'padding:24px',
            'background:rgba(0,0,0,.5)',
            'font:400 13px/1.4 ui-sans-serif,system-ui,sans-serif'
        ].join(';');

        // The overlay lives outside the rail, so it carries its own copy of the
        // palette. Applied after cssText for the same reason the rail's is, and
        // read once at open — a modal is transient enough that following a theme
        // change mid-view is not worth the machinery.
        applyPalette(backdrop);

        // Only a click on the backdrop itself, so a click that lands inside the
        // dialog and bubbles out does not dismiss it.
        backdrop.addEventListener('click', event => {
            if (event.target === backdrop) closePreview();
        });

        const dialog = document.createElement('div');
        dialog.style.cssText = [
            'display:flex',
            'flex-direction:column',
            'width:min(900px,100%)',
            // Bounded by the viewport rather than by the content, so a long
            // conversation scrolls inside the dialog instead of stretching it off
            // the screen.
            'max-height:80vh',
            'border-radius:12px',
            `border:1px solid ${border}`,
            `background:${surface}`,
            `color:${text}`,
            'box-shadow:0 8px 32px rgba(0,0,0,.35)',
            'overflow:hidden'
        ].join(';');

        const header = document.createElement('div');
        header.style.cssText = [
            'display:flex',
            'align-items:center',
            'justify-content:space-between',
            'gap:12px',
            'padding:10px 12px',
            `border-bottom:1px solid ${border}`
        ].join(';');

        const name = document.createElement('div');
        name.textContent = buildExportName('md', now);
        name.style.cssText = [
            'font-size:12px',
            `color:${muted}`,
            'overflow:hidden',
            'text-overflow:ellipsis',
            'white-space:nowrap'
        ].join(';');

        // Escape and clicking away both work, but neither announces itself. A
        // visible control is the only dismissal a first-time user can see.
        const close = document.createElement('button');
        close.type = 'button';
        close.textContent = 'Close';
        close.style.cssText = [
            'flex:none',
            'padding:4px 10px',
            'border-radius:6px',
            'cursor:pointer',
            'font:inherit',
            `border:1px solid ${border}`,
            'background:transparent',
            `color:${text}`
        ].join(';');
        close.addEventListener('click', closePreview);

        // The same tiles as the rail, so the two surfaces read as one tool. Both
        // are handed the moment the header was built from, so pressing one here
        // writes the file whose name is on display beside it — deriving a fresh
        // moment would rename the file out from under the label.
        //
        // The overlay stays open afterwards: both formats are plausibly wanted from
        // one reading, and closing would remove the thing being checked.
        const actions = document.createElement('div');
        actions.style.cssText = 'display:flex;align-items:center;gap:6px;flex:none';
        actions.appendChild(buildTile(ICONS.markdown, '.md', 'Export the conversation as Markdown', () => exportMarkdown(now)));
        actions.appendChild(buildTile(ICONS.html, '.html', 'Export the conversation markup as HTML', () => exportHtml(now)));
        actions.appendChild(close);

        header.appendChild(name);
        header.appendChild(actions);

        const body = document.createElement('pre');
        body.textContent = markdown;
        body.style.cssText = [
            'margin:0',
            'padding:12px',
            'overflow:auto',
            'white-space:pre-wrap',
            'word-break:break-word',
            'font:12px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace',
            `color:${text}`
        ].join(';');

        dialog.appendChild(header);
        dialog.appendChild(body);
        backdrop.appendChild(dialog);

        document.addEventListener('keydown', onPreviewKey);
        document.body.appendChild(backdrop);
    }

    const PANEL_ID = 'chatgpt-exporter-panel';

    // Our own palette, applied to our own elements as custom properties.
    //
    // An earlier version read ChatGPT's theme tokens directly. Every one of those
    // names had been renamed, which produced no error at all — just a light rail on
    // a dark page, for a whole day. Naming another vendor's private variables is a
    // bet that has to be re-won on every release, and it loses silently.
    const PALETTES = {
        dark: { surface: '#303030', text: '#ececec', muted: '#9b9b9b', border: 'rgba(150,150,150,.35)' },
        light: { surface: '#ffffff', text: '#0d0d0d', muted: '#5d5d5d', border: 'rgba(120,120,120,.35)' }
    };

    // The readiness dot is the same green in both, because it reports this script
    // rather than the page it is standing on.
    const READY = '#10a37f';

    const SURFACE = 'var(--cge-surface)';
    const BORDER = 'var(--cge-border)';
    const TEXT = 'var(--cge-text)';
    const MUTED = 'var(--cge-muted)';

    // Decide light or dark without naming anything ChatGPT owns.
    function detectScheme() {
        // `color-scheme` is a CSS standard rather than a vendor token — browsers
        // use it for scrollbars and form controls, so it cannot quietly become
        // something else the way `--token-*` did. It reads `dark` on ChatGPT today.
        const declared = getComputedStyle(document.documentElement).colorScheme || '';
        const wantsDark = /\bdark\b/.test(declared);
        const wantsLight = /\blight\b/.test(declared);
        if (wantsDark !== wantsLight) return wantsDark ? 'dark' : 'light';

        // Unset, or "light dark" meaning either is acceptable: ask the page what it
        // actually looks like.
        const sampled = sampleScheme();
        if (sampled) return sampled;

        // The operating system, consulted last because a site can and does override
        // it — trusting this first would get a light-themed page wrong on a dark
        // desktop.
        return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }

    function sampleScheme() {
        const parts = getComputedStyle(document.body).backgroundColor.match(/[\d.]+/g);
        if (!parts) return null;

        // A transparent body says nothing about the theme.
        if (parts.length > 3 && Number(parts[3]) === 0) return null;

        const [r, g, b] = parts.map(Number);
        return (r * 0.2126 + g * 0.7152 + b * 0.0722) < 128 ? 'dark' : 'light';
    }

    // Paints the palette onto one of our own elements, which its descendants then
    // inherit. Nothing is written to the page's own nodes.
    function applyPalette(element) {
        const scheme = detectScheme();

        // Repainting is skipped when nothing changed, for the reason item 18
        // documented: this runs from an observer, and writing unconditionally is
        // how a panel ends up updating itself forever.
        if (element.dataset.cgeScheme === scheme) return;
        element.dataset.cgeScheme = scheme;

        const palette = PALETTES[scheme];
        Object.keys(palette).forEach(key => {
            element.style.setProperty(`--cge-${key}`, palette[key]);
        });
    }

    // Drawn inline rather than fetched: ChatGPT's connect-src blocks requests to
    // anywhere we could host them, and `currentColor` makes them follow the theme
    // for free. ChatGPT's own sprite sheet is deliberately not reused — its
    // filename carries a build hash and changes without warning.
    const ICONS = {
        preview: '<path d="M1.5 10S4.7 4.5 10 4.5 18.5 10 18.5 10 15.3 15.5 10 15.5 1.5 10 1.5 10z"/><circle cx="10" cy="10" r="2.4"/>',
        markdown: '<path d="M10 3.2v8.6M6.6 8.4 10 11.8l3.4-3.4M4 16h12"/>',
        html: '<path d="M7.4 6 3.2 10l4.2 4M12.6 6l4.2 4-4.2 4"/>'
    };

    function buildIcon(paths) {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 20 20');
        svg.setAttribute('aria-hidden', 'true');
        svg.setAttribute('style', 'width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round;display:block');
        svg.innerHTML = paths;
        return svg;
    }

    // Icon and label share one bordered box so they read as a single control.
    // Placing a label near an icon and relying on the gap is what this replaces —
    // proximity is arguable, an enclosing border is not.
    function buildTile(icon, label, description, handler) {
        const tile = document.createElement('button');
        tile.type = 'button';

        // The only name a screen reader gets: the eye has no text at all, and an
        // extension alone does not say what pressing it does.
        tile.title = description;
        tile.setAttribute('aria-label', description);

        tile.style.cssText = [
            'display:flex',
            'flex-direction:column',
            'align-items:center',
            'gap:1px',
            'width:34px',
            label ? 'padding:4px 0 3px' : 'padding:6px 0',
            'border-radius:8px',
            `border:1px solid ${BORDER}`,
            'background:transparent',
            `color:${TEXT}`,
            'cursor:pointer',
            'font:inherit'
        ].join(';');

        tile.appendChild(buildIcon(icon));

        if (label) {
            const caption = document.createElement('span');
            caption.textContent = label;
            caption.style.cssText = `font-size:8px;letter-spacing:.02em;color:${MUTED}`;
            tile.appendChild(caption);
        }

        tile.addEventListener('click', handler);
        return tile;
    }

    // A rail rather than a card, because the export is about the conversation in
    // front of you and the control belongs beside it. Mid-right: ChatGPT uses the
    // bottom of the viewport for its own scroll and composer controls, so anchoring
    // there invites a collision on every redesign.
    function buildPanel() {
        const panel = document.createElement('div');
        panel.id = PANEL_ID;
        panel.style.cssText = [
            'position:fixed',
            'right:12px',
            'top:50%',
            'transform:translateY(-50%)',
            'z-index:2147483647',
            'display:flex',
            'flex-direction:column',
            'align-items:center',
            'gap:6px',
            'padding:8px 6px',
            'border-radius:12px',
            `border:1px solid ${BORDER}`,
            `background:${SURFACE}`,
            'box-shadow:0 2px 10px rgba(0,0,0,.25)',
            'font:500 12px/1.2 ui-sans-serif,system-ui,sans-serif'
        ].join(';');

        // After cssText, never before: assigning cssText replaces the whole inline
        // declaration and would wipe the custom properties the palette sets.
        applyPalette(panel);

        // Broken over two lines, which in a vertical writing mode makes two columns
        // rather than a longer run. It costs no width — the rail is as wide as its
        // tiles — and takes about 40px off the rail's height.
        const wordmark = document.createElement('div');
        wordmark.append('ChatGPT', document.createElement('br'), 'Exporter');
        wordmark.style.cssText = [
            'writing-mode:vertical-rl',
            'transform:rotate(180deg)',
            'padding:2px 0',
            'font-size:11px',
            // Leading of 1 pulls the two columns together so they read as one
            // wordmark rather than as two separate words.
            'line-height:1',
            'font-weight:600',
            'letter-spacing:.12em',
            'text-transform:uppercase',
            'text-align:center',
            `color:${MUTED}`,
            'cursor:default',
            'user-select:none'
        ].join(';');
        panel.appendChild(wordmark);

        // The dot reports this script, not the conversation, so it never changes.
        // Its honest limit: it cannot report a broken exporter, because the code
        // that would change it is the code that failed. The rail being absent
        // altogether is what that failure looks like.
        const status = document.createElement('div');
        status.setAttribute('data-exporter-status', '');
        status.style.cssText = 'display:flex;align-items:center;gap:4px;height:11px;cursor:default;user-select:none';

        const dot = document.createElement('span');
        dot.style.cssText = `width:7px;height:7px;border-radius:999px;background:${READY};flex:none`;
        status.appendChild(dot);

        const count = document.createElement('span');
        count.setAttribute('data-exporter-count', '');
        count.style.cssText = `font-size:11px;font-weight:700;line-height:1;color:${TEXT}`;
        status.appendChild(count);

        panel.appendChild(status);

        // Preview first: it is the one that writes nothing, and reading before
        // writing is the order to fall into. Its tile carries no label because it
        // produces no file, so there is no extension to name.
        panel.appendChild(buildTile(ICONS.preview, '', 'Preview the Markdown export', previewMarkdown));
        panel.appendChild(buildTile(ICONS.markdown, '.md', 'Export the conversation as Markdown', exportMarkdown));
        panel.appendChild(buildTile(ICONS.html, '.html', 'Export the conversation markup as HTML', exportHtml));

        return panel;
    }

    // The conversation's state lives in the tiles rather than in words: they are
    // inert with nothing to export and live once there are turns. The count appears
    // beside the dot only when there is one to show.
    function updatePanelState(panel) {
        const turns = findTurns().length;
        const label = turns ? String(turns) : '';
        const count = panel.querySelector('[data-exporter-count]');

        // Only write when it actually changed. This runs from a MutationObserver
        // watching the whole subtree, and replacing the text node is itself a
        // mutation — assigning unconditionally would retrigger the observer and
        // leave the rail updating itself forever.
        if (count.textContent !== label) count.textContent = label;

        // Take the count out of the layout entirely when empty. An empty span is
        // still a flex item, so the row's gap would still be applied and would push
        // the dot off the rail's centre — visible, because the dot is the only thing
        // in the row at that point and has nothing to be balanced against.
        count.style.display = label ? '' : 'none';

        panel.querySelectorAll('button').forEach(button => {
            button.disabled = !turns;
            button.style.opacity = turns ? '1' : '.35';
            button.style.cursor = turns ? 'pointer' : 'default';
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

        applyPalette(panel);
        updatePanelState(panel);
    }

    function installPanel() {
        syncPanel();

        // Coalesce bursts of mutation — streaming a reply fires these continuously,
        // and the check only needs to run once things settle.
        let pending = 0;
        const schedule = () => {
            clearTimeout(pending);
            pending = setTimeout(syncPanel, 300);
        };

        new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });

        // Switching theme changes attributes on the root element and need not touch
        // the body's children at all, so the observer above can miss it entirely.
        new MutationObserver(schedule).observe(document.documentElement, {
            attributes: true,
            attributeFilter: ['class', 'style', 'data-theme', 'data-chat-theme']
        });

        // And the operating system's preference, for the case where the page is
        // following it rather than declaring its own.
        matchMedia('(prefers-color-scheme: dark)').addEventListener('change', schedule);
    }

    // The panel is the interface in both modes. Under a userscript manager it is
    // the only one, so the menu commands stay as a fallback for the case where a
    // future ChatGPT stylesheet hides the panel. Pasted into a console the panel is
    // still better than exporting immediately: both artifacts become available,
    // where a one-shot paste could only ever produce one of them.
    if (typeof GM_registerMenuCommand === 'function') {
        GM_registerMenuCommand('Preview the Markdown export', previewMarkdown);
        GM_registerMenuCommand('Export conversation to Markdown', exportMarkdown);
        GM_registerMenuCommand('Export conversation markup as HTML', exportHtml);
    }

    installPanel();

    // The value this evaluates to is what a console prints after a paste, and for
    // that path it is the only confirmation anything happened — an IIFE returning
    // nothing prints `undefined`, which reads like failure.
    //
    // Returned rather than logged on purpose. Under a userscript manager this file
    // runs on every page view, where a log line each time would be noise, while an
    // unread completion value costs nothing.
    const ready = findTurns().length;
    return `ChatGPT Exporter ready — ${ready ? `${ready} turn${ready === 1 ? '' : 's'}` : 'no conversation'}`;
})();