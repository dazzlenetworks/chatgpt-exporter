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
        if (tag === 'p') return children ? `${children}\n\n` : '';

        return children;
    }


    function extractCodeBlocks(container) {
        container.querySelectorAll('pre').forEach(pre => {
            const codeEl = pre.querySelector('code');
            const code = cleanText(renderInline(codeEl || pre));

            let lang = '';
            const className = codeEl?.className || '';
            const match = className.match(/language-([\w]+)/);
            if (match) lang = match[1];

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


    function extractMessageText(container) {
        if (!container) return '';

        const processed = container.cloneNode(true);
        normalizeWhitespace(processed);
        extractCodeBlocks(processed);
        stripNoise(processed);
        extractHorizontalRules(processed);
        extractHeadings(processed);
        extractInlineCode(processed);
        extractLists(processed);
        extractBlockquotes(processed);

        // Replace image-like content with an inline placeholder so the marker
        // stays where the image appeared instead of collecting at the end.
        processed.querySelectorAll('img, canvas').forEach(el => {
            el.replaceWith(document.createTextNode('[Image]'));
        });

        return cleanText(renderInline(processed));
    }



    // Conversation turns are identified by ChatGPT's role attribute. The
    // desktop site uses `data-message-author-role`; the mobile web app uses
    // `data-message-role`. Support both so exports work across layouts.
    const turns = document.querySelectorAll('[data-message-author-role], [data-message-role]');
    const lines = [];


    const title = 'ChatGPT Conversation Export';
    const now = new Date();
    const created = formatCreatedFrontmatter(now);
    const filenameTimestamp = formatFilenameTimestamp(now);


    const chatTitle =
        getChatTitle() || firstUserMessageTitle(turns) || 'Untitled chat';
    const url = window.location.href;

    if (!turns.length) {
        console.warn('No conversation turns were found. ChatGPT may have changed its page structure.');
        return;
    }

    lines.push('---');
    lines.push(`created: ${created}`);
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

    const blob = new Blob([markdown], { type: 'text/markdown' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${filenameTimestamp} ChatGPT export - ${chatTitle}.md`;

    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    console.log('Export complete.');
})();