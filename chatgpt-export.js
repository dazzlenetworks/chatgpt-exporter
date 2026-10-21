// ==UserScript==
// @name         ChatGPT Exporter
// @namespace    https://github.com/dazzlenetworks/chatgpt-exporter
// @version      1.0.0
// @description  Export the open ChatGPT conversation to Markdown or HTML.
// @match        https://chatgpt.com/*
// @grant        GM_registerMenuCommand
// @updateURL    https://raw.githubusercontent.com/dazzlenetworks/chatgpt-exporter/master/chatgpt-export.js
// @downloadURL  https://raw.githubusercontent.com/dazzlenetworks/chatgpt-exporter/master/chatgpt-export.js
// @license      MIT
// ==/UserScript==

/*
 * ChatGPT Exporter
 *
 * Paste this script into the browser console while viewing a ChatGPT
 * conversation page. It will extract visible conversation turns and download
 * them as a Markdown file. The block above is for userscript managers, which
 * read it to install the script and to keep it updated; a console paste
 * treats it as comments.
 *
 * A userscript manager only takes an update when @version goes up, so raise it
 * with every change to this file that should reach installed copies. It is a
 * semantic version: the last number for a fix, the middle one for something
 * new, the first for a change to what an export looks like that a reader or a
 * tool relying on it would have to adjust to. VERSION below says the same thing
 * to the exports themselves, so the two always move together.
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
    // The same as @version above. A console paste cannot read the header, so the
    // exports and the preview take it from here.
    const VERSION = '1.0.0';

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
    //
    // A user's prompt is not passed through here at all: it is the raw text that
    // was typed, shown pre-wrapped, so its newlines are the user's own line breaks
    // and its spaces are what they typed, not wraps in the page source.
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

    // Markdown joins the lines of a paragraph, so a single newline the user typed
    // would render as a space. Each one becomes a two-space hard break. That runs
    // after cleanText, which would otherwise strip the spaces. A backslash hard
    // break was tried first and Obsidian prints the backslash. A blank line is
    // already a paragraph break and is left alone.
    //
    // Three places take no break, because there it would do harm. Before a line
    // that starts a block of its own (a quote, heading, list item or fence) the
    // block already begins on its own line. Inside a fence the text is code, and a
    // fence line itself must end bare or it no longer opens or closes one. And
    // after a quoted line, a plain newline would fold the next line into the
    // quote, so a quote is closed with a blank line instead. Between two quoted
    // lines the break goes in as usual, and breaks the line inside the quote.
    function userLineBreaks(text) {
        const lines = text.split('\n');
        const startsBlock = line => /^\s{0,3}(>|#{1,6}\s|[-*+]\s|\d+[.)]\s|```|~~~)/.test(line);
        const isQuote = line => /^\s{0,3}>/.test(line);
        const isFence = line => /^\s{0,3}(```|~~~)/.test(line);

        let inFence = false;
        let out = lines[0];

        for (let i = 1; i < lines.length; i++) {
            const prev = lines[i - 1];
            const line = lines[i];
            if (isFence(prev)) inFence = !inFence;

            if (inFence || isFence(prev) || prev === '' || line === '') {
                out += '\n' + line;
            } else if (isQuote(prev) && !isQuote(line)) {
                out += '\n\n' + line;
            } else if (startsBlock(line) && !isQuote(prev)) {
                out += '\n' + line;
            } else {
                out += '  \n' + line;
            }
        }

        return out;
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

        return languageToken(text);
    }

    // A language tag is one short token. Anything longer means the header was
    // not found and we are looking at interface text, so take nothing.
    function languageToken(text) {
        return /^[a-z0-9+#.-]{1,15}$/i.test(text) ? text.toLowerCase() : '';
    }

    // The component layout has neither a language-* class nor a CodeMirror
    // header. It wraps the block as <div><span>python</span><pre>…</pre></div>,
    // so the label is a sibling of the <pre> rather than anything inside it. Taken
    // only when the wrapper holds that one label and the block and nothing else —
    // in the classic layout a <pre>'s parent is the whole message, which never
    // fits. The label element is returned so it can be removed; left in place it
    // would also export as a paragraph above the fence.
    function readSiblingLabel(pre) {
        const parent = pre.parentElement;
        if (!parent) return null;

        const others = Array.from(parent.children).filter(child => child !== pre);
        if (others.length !== 1 || others[0].nextElementSibling !== pre) return null;

        const label = others[0];
        const strayText = Array.from(parent.childNodes).some(node =>
            node.nodeType === Node.TEXT_NODE && node.textContent.trim());
        if (strayText) return null;

        const lang = languageToken((label.textContent || '').trim());
        return lang ? { lang, label } : null;
    }

    function extractCodeBlocks(container) {
        container.querySelectorAll('pre').forEach(pre => {
            const codeEl = pre.querySelector('code');
            const code = readCodeText(pre, codeEl);
            let lang = readCodeLanguage(pre, codeEl);

            if (!lang) {
                const sibling = readSiblingLabel(pre);
                if (sibling) {
                    lang = sibling.lang;
                    sibling.label.remove();
                }
            }

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

            // The newer layout puts title components inside boxes too — a card's
            // title, a stat tile's value — where a heading would rank them beside
            // the reply's own sections. Those are bold paragraphs instead.
            if (heading.closest('[data-d-component="box"]')) {
                replaceElementWithMarkdown(heading, `\n\n**${text}**\n\n`);
                return;
            }

            replaceElementWithMarkdown(heading, `\n${'#'.repeat(level)} ${text}\n`);
        });

        return container;
    }

    // Tables become GitHub-flavoured Markdown tables. ChatGPT's newer layout wraps
    // every cell's content in a <p>, so a cell is rendered as its paragraphs
    // joined with <br>: a Markdown cell cannot hold a line break, and a pipe
    // inside one would end it early. The first row is the header whether or not
    // its cells are <th>, because a Markdown table cannot exist without one.
    // Runs after inline code has become backtick text, so code in a cell survives.
    function extractTables(container) {
        container.querySelectorAll('table').forEach(table => {
            const rows = Array.from(table.querySelectorAll('tr'))
                .filter(row => row.closest('table') === table)
                .map(row => Array.from(row.children)
                    .filter(cell => /^t[hd]$/i.test(cell.tagName))
                    .map(renderTableCell));

            const width = Math.max(0, ...rows.map(cells => cells.length));
            if (!width) {
                table.remove();
                return;
            }

            const line = cells => {
                const padded = cells.concat(Array(width - cells.length).fill(''));
                return `| ${padded.join(' | ')} |`;
            };

            const markdown = [
                line(rows[0]),
                line(Array(width).fill('---')),
                ...rows.slice(1).map(line)
            ].join('\n');

            replaceElementWithMarkdown(table, `\n\n${markdown}\n\n`);
        });

        return container;
    }

    function renderTableCell(cell) {
        return cleanText(renderInline(cell))
            .split(/\n+/)
            .map(part => part.trim())
            .filter(Boolean)
            .join('<br>')
            .replace(/\|/g, '\\|');
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

            // A blank line either side, written here rather than left to the markup
            // around the list. The classic layout has whitespace between its block
            // elements, which used to supply the second newline; the newer layout
            // has none, and a paragraph on the very next line after a list is read
            // as part of its last item. cleanText collapses any surplus.
            const isOrdered = list.tagName.toLowerCase() === 'ol';
            const markdown = renderList(list, isOrdered ? 0 : 0);
            replaceElementWithMarkdown(list, `\n\n${markdown}\n\n`);
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

    // ChatGPT's web-search citations are no longer <a> links but buttons whose
    // data-assistant-sources-payload is a JSON array of {attribution, title, url}.
    // The inline pills stay dropped — a citation mid-sentence is clutter in a
    // reading copy — but the reference URLs are worth keeping, so the message-level
    // "sources_footnote" button, which is ChatGPT's own curated list, becomes a
    // Sources section at the end of the turn. Where a message carries inline
    // citations but no footnote, the inline payloads are aggregated instead so
    // nothing is lost. Runs before stripNoise, which removes the buttons.
    function extractSourceCitations(container) {
        const footnotes = Array.from(
            container.querySelectorAll('[data-content-reference-type="sources_footnote"]')
        );
        const sources = dedupeByUrl(
            footnotes.length ? footnotes.flatMap(readSourcesPayload) : allInlineSources(container)
        );
        footnotes.forEach(footnote => footnote.remove());

        if (!sources.length) return container;

        const items = sources.map(source => {
            const url = stripChatgptTracking(source.url);
            const label = citationLabel(source) || url;
            const target = /[()\s]/.test(url) ? `<${url}>` : url;
            return `- [${label}](${target})`;
        });

        // One text node so the later block passes leave it alone; renderInline emits
        // it verbatim and cleanText collapses the blank line it opens with.
        container.appendChild(
            document.createTextNode(`\n\n**Sources:**\n\n${items.join('\n')}\n`)
        );
        return container;
    }

    function readSourcesPayload(button) {
        try {
            const payload = JSON.parse(button.getAttribute('data-assistant-sources-payload') || '[]');
            return Array.isArray(payload) ? payload.filter(source => source && source.url) : [];
        } catch (error) {
            return [];
        }
    }

    function allInlineSources(container) {
        return Array.from(container.querySelectorAll('[data-assistant-sources-payload]'))
            .flatMap(readSourcesPayload);
    }

    function dedupeByUrl(sources) {
        const seen = new Set();
        return sources.filter(source => {
            if (seen.has(source.url)) return false;
            seen.add(source.url);
            return true;
        });
    }

    // The title describes the page and makes the better archive label; the bare
    // attribution is the fallback. Strip the brackets that would otherwise break
    // the Markdown link label, and collapse any wrapping whitespace.
    function citationLabel(source) {
        return (source.title || source.attribution || '')
            .replace(/[\[\]]/g, '')
            .replace(/\s+/g, ' ')
            .trim();
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

    // A box in the newer layout can hold its body as bare text after a title row,
    // with no <p> around it. Only a <p> ends a paragraph when rendered, so that
    // text would run straight into the next block. Each run of text and inline
    // elements directly inside a box is wrapped in a <p> of its own.
    function wrapBareBoxText(container) {
        const inline = /^(a|b|code|em|i|span|strong)$/;
        container.querySelectorAll('[data-d-component="box"]').forEach(box => {
            let run = [];
            const wrap = () => {
                if (run.some(node => /\S/.test(node.textContent || ''))) {
                    const p = document.createElement('p');
                    run[0].before(p);
                    run.forEach(node => p.appendChild(node));
                }
                run = [];
            };
            Array.from(box.childNodes).forEach(node => {
                if (node.nodeType === Node.TEXT_NODE ||
                    (node.nodeType === Node.ELEMENT_NODE && inline.test(node.tagName.toLowerCase()))) {
                    run.push(node);
                } else {
                    wrap();
                }
            });
            wrap();
        });

        return container;
    }

    // ChatGPT's newer layout can set out a list as cards: each a row of two
    // boxes, a thumbnail or an icon beside a stack of paragraphs — a title, a
    // subtitle in the secondary text colour where there is one, then the body.
    // The thumbnail is dropped: its alt text names the page the image was found
    // on, not the card, and keeping it would cite a source nobody cited. The
    // title is made bold and the subtitle italic by rewriting the paragraphs in
    // place, so the rest of the pipeline renders links and code in them as it
    // would anywhere. Runs before stripNoise and extractImages, which would
    // otherwise turn the thumbnail into an [Image] marker first.
    function extractCards(container) {
        container.querySelectorAll('[data-d-component="row"]').forEach(row => {
            const boxes = Array.from(row.children);
            if (boxes.length !== 2 ||
                !boxes.every(box => box.getAttribute('data-d-component') === 'box')) return;

            const [media, body] = boxes;
            if (!media.querySelector('[data-d-component="image"], [data-d-component="icon"]')) return;
            if ((media.textContent || '').trim()) return;

            const paragraphs = Array.from(body.children);
            if (paragraphs.length < 2 ||
                !paragraphs.every(p => p.tagName.toLowerCase() === 'p')) return;

            media.remove();
            wrapChildren(paragraphs[0], 'strong');
            paragraphs.slice(1)
                .filter(p => /--color-text-secondary/.test(p.getAttribute('style') || ''))
                .forEach(p => wrapChildren(p, 'em'));
        });

        return container;
    }

    // ChatGPT's newer layout can draw a vertical flowchart as a stack of boxes:
    // steps, each a title and a subtitle with an optional icon, and between them
    // arrows, each an icon and a short label. Exported as a Mermaid flowchart,
    // which renders as a diagram where Mermaid is supported and reads as text
    // everywhere else.
    //
    // Detection is strict. Only a stack that alternates exactly — step, arrow,
    // step, …, step — is drawn. A step needs two paragraphs, because a step of one
    // paragraph and an icon would look exactly like an arrow; anything that does
    // not fit is left alone and exports as paragraphs, as it always has, so a
    // miss costs nothing new.
    function extractFlowcharts(container) {
        container.querySelectorAll('[data-d-component="box"]').forEach(stack => {
            const boxes = Array.from(stack.children);
            if (boxes.length < 3 || boxes.length % 2 === 0) return;
            if (!boxes.every(box => box.getAttribute('data-d-component') === 'box')) return;

            const parts = boxes.map(flowchartPart);
            const alternates = parts.every((part, i) =>
                part && part.kind === (i % 2 === 0 ? 'step' : 'arrow'));
            if (!alternates) return;

            const label = text => `"${text.replace(/"/g, '#quot;')}"`;
            const steps = parts.filter(part => part.kind === 'step');
            const lines = ['flowchart TD'];

            steps.forEach((step, i) => {
                lines.push(`    n${i + 1}[${label(step.lines.join('<br/>'))}]`);
            });
            parts.forEach((part, i) => {
                if (part.kind !== 'arrow') return;
                const from = i / 2 + 0.5;
                lines.push(`    n${from} -->|${label(part.lines[0])}| n${from + 1}`);
            });

            replaceElementWithMarkdown(stack, `\n\n\`\`\`mermaid\n${lines.join('\n')}\n\`\`\`\n\n`);
        });

        return container;
    }

    // A stack of boxes can also be joined by bare arrow icons, with no label and
    // no box of their own, which extractFlowcharts does not draw. stripNoise
    // would remove them with every other svg and leave the stack as unrelated
    // paragraphs, so each becomes an arrow on a line of its own.
    function extractBareArrows(container) {
        const arrows = { 'arrow-down-up': '↕', 'arrow-down': '↓' };
        container.querySelectorAll('[data-d-component="box"] > [data-d-component="icon"]').forEach(icon => {
            const name = (icon.getAttribute('data-icon-name') || '').replace(/^lucide:/, '');
            if (arrows[name]) replaceElementWithMarkdown(icon, `\n\n${arrows[name]}\n\n`);
        });

        return container;
    }

    // A box's role in a flowchart, from what it directly holds: an optional icon
    // and two paragraphs is a step; an icon and one paragraph is an arrow.
    function flowchartPart(box) {
        const children = Array.from(box.children);
        const icons = children.filter(child => child.getAttribute('data-d-component') === 'icon');
        const paragraphs = children.filter(child => child.tagName.toLowerCase() === 'p');
        if (icons.length + paragraphs.length !== children.length || icons.length > 1) return null;

        const lines = paragraphs
            .map(p => (p.textContent || '').replace(/\s+/g, ' ').trim())
            .filter(Boolean);
        if (lines.length !== paragraphs.length) return null;

        if (lines.length === 2) return { kind: 'step', lines };
        if (lines.length === 1 && icons.length === 1) return { kind: 'arrow', lines };
        return null;
    }

    function wrapChildren(element, tag) {
        const wrapper = document.createElement(tag);
        while (element.firstChild) wrapper.appendChild(element.firstChild);
        element.appendChild(wrapper);
    }

    // A reply can end with a form of multiple-choice questions: each question a
    // paragraph, its options a radio group. The options carry no separators, so
    // left alone they run together on one line, and the next question with them.
    // Each group becomes a bullet list under its question. No option is marked
    // chosen: the first radio of a group is checked by default, which is the
    // widget's resting state rather than an answer anybody gave.
    function extractRadioGroups(container) {
        container.querySelectorAll('[role="radiogroup"], [data-d-component="radio-group"]').forEach(group => {
            if (group.parentElement?.closest('[role="radiogroup"], [data-d-component="radio-group"]')) return;

            let options = Array.from(group.querySelectorAll('[data-d-component="radio"], [role="radio"]'));
            if (!options.length) options = Array.from(group.querySelectorAll('label'));

            const items = options
                .map(option => cleanText(renderInline(option)).replace(/\s*\n\s*/g, ' '))
                .filter(Boolean)
                .map(text => `- ${text}`);

            if (!items.length) {
                group.remove();
                return;
            }

            replaceElementWithMarkdown(group, `\n\n${items.join('\n')}\n\n`);
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

            // A blank line either side, for the reason extractLists gives: the
            // newer layout has no whitespace between blocks to supply one.
            replaceElementWithMarkdown(blockquote, `\n\n${quoted}\n\n`);
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
            //
            // The newer layout also cites a source as a chip outside any link: a
            // favicon beside the source's title. The chip's markup holds no URL for
            // the source, only the favicon's, so the title is all there is to keep
            // and the favicon goes the same way.
            if (el.closest('a, [data-d-component="favicon"]')) {
                el.remove();
                return;
            }

            // Elsewhere the marker stays inline, where the image appeared,
            // instead of collecting at the end.
            replaceElementWithMarkdown(el, '[Image]');
        });

        return container;
    }


    function extractMessageText(container, isUser = false) {
        if (!container) return '';

        const processed = container.cloneNode(true);
        if (!isUser) normalizeWhitespace(processed);
        extractCodeBlocks(processed);
        extractEntityReferences(processed);
        extractSourceCitations(processed);
        wrapBareBoxText(processed);
        extractCards(processed);
        extractFlowcharts(processed);
        extractBareArrows(processed);
        stripNoise(processed);
        extractRadioGroups(processed);
        extractImages(processed);
        extractHorizontalRules(processed);
        extractHeadings(processed);
        extractInlineCode(processed);
        extractTables(processed);
        extractLists(processed);
        extractBlockquotes(processed);

        const text = cleanText(renderInline(processed));
        return isUser ? userLineBreaks(text) : text;
    }



    // Conversation turns are identified by ChatGPT's role attribute. The
    // classic layout uses `data-message-author-role`; the newer stylex one uses
    // `data-message-role`. Support both so exports work across layouts.
    //
    // This finds what is *rendered*, which is not the same as what the
    // conversation contains — see conversationInventory below.
    function findTurns() {
        return document.querySelectorAll('[data-message-author-role], [data-message-role]');
    }

    // What the conversation holds, against what is rendered right now.
    //
    // ChatGPT sheds turns two ways. A **virtualised** turn keeps its container
    // and drops its content, so it is in the document but invisible to
    // findTurns; a **paginated-out** turn is not in the document at all. Either
    // produces an export that is silently short, which is this script's worst
    // failure: the Markdown is well-formed, the turns present are correct, and
    // nothing says the rest is missing.
    //
    // The container is the inventory. Verified against a real truncated capture
    // on 9/22/2026: strip `client-created-root`, dedupe, and the nth container
    // is `data-testid="conversation-turn-n"` — dense and 1:1. That capture was
    // rendering 8 turns of the 20 it was holding.
    function conversationInventory() {
        const ids = new Set();

        document.querySelectorAll('[data-turn-id-container]').forEach(el => {
            const id = el.getAttribute('data-turn-id-container');

            // ChatGPT's anchor for a freshly created conversation. It is a
            // container like the others and carries no message, so counting it
            // would report every conversation as one turn short.
            if (id && id !== 'client-created-root') ids.add(id);
        });

        const loaded = findTurns().length;

        // No containers at all means a layout this does not know — the stylex
        // one, or whatever follows it. Deliberately not reported as complete:
        // nothing is known about how those shed turns, and a check that answers
        // confidently about markup nobody has observed is a check that passes
        // while proving nothing.
        if (!ids.size) {
            return { verifiable: false, complete: false, loaded, total: loaded, unfetched: false };
        }

        // The sentinel marks where ChatGPT fetches earlier turns, and it goes away
        // once there are none left to fetch. Verified against the live site on
        // 9/22/2026: a 40-turn conversation reached the top through four fetches
        // and the sentinel cleared as the last one landed.
        //
        // So its presence decides on its own, and it has to — a turn that has not
        // been fetched has no container, so the count below cannot see it. On a
        // fresh load of that conversation the count was 10.
        const unfetched = !!document.querySelector('[data-testid="conversation-pagination-sentinel"]');

        // Which is also why `total` is a floor rather than a length while the
        // sentinel is up. ChatGPT creates containers a page of ten at a time as
        // the scroller reaches the top, and renumbers `conversation-turn-N` across
        // the whole loaded set each time a page lands — so neither the container
        // count nor the highest index says how long the conversation is. Only the
        // sentinel clearing does.
        return {
            verifiable: true,
            complete: loaded >= ids.size && !unfetched,
            loaded,
            total: ids.size,
            totalIsFloor: unfetched,
            unfetched
        };
    }

    // Said once per export or preview rather than from the observer that keeps the
    // rail current: that runs on every mutation, and a console line per mutation
    // is noise, which trains the reader to ignore the one line that mattered.
    function reportCompleteness(inventory) {
        if (!inventory.verifiable) {
            console.warn(
                'Export completeness could not be verified on this page layout. ' +
                'This export holds every turn currently rendered, which may not be the whole conversation.'
            );
            return;
        }

        if (inventory.complete) return;

        console.warn(
            `Incomplete export: ${inventory.loaded} of ` +
            (inventory.totalIsFloor ? `at least ${inventory.total}` : String(inventory.total)) +
            ' turns are loaded.' +
            (inventory.totalIsFloor
                ? ' ChatGPT has not fetched the earlier ones yet, so the conversation is longer than that number.'
                : '') +
            ' Scroll to the top to load the rest, then export.'
        );
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
    // A signed-in conversation lives at /c/<id> and a logged-out one at /uc/<id>;
    // both ids carry the time the same way.
    //
    // The format is inferred rather than documented, so every part of it is checked
    // before the value is used. A wrong date stated confidently is worse than an
    // absent one, so anything unexpected returns null and the field is left out.
    function conversationStarted(pathname = window.location.pathname) {
        const id = pathname.match(
            /\/u?c\/([0-9a-f]{8})-[0-9a-f]{4}-([0-9a-f])[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}/i
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
    function exportHtml(moment, stamp) {
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

        const inventory = conversationInventory();

        reportCompleteness(inventory);

        // The same note the Markdown frontmatter carries. This file has no
        // frontmatter to put it in, and the provenance comment is already where a
        // reader looks to find out what they are holding.
        //
        // Ahead of the URL rather than after it: it is the thing to notice first,
        // and anything trailing a URL reads as part of it.
        const shortfall = inventory.verifiable && !inventory.complete
            ? ` INCOMPLETE: ${inventory.loaded} of ` +
              (inventory.totalIsFloor
                  ? `at least ${inventory.total} turns; ChatGPT had not fetched the earlier ones.`
                  : `${inventory.total} turns.`)
            : '';

        // A charset declaration so the file survives being opened later, and a
        // provenance comment so a folder of these can be told apart.
        const html = [
            '<!DOCTYPE html>',
            '<meta charset="utf-8">',
            `<!-- ChatGPT conversation markup, by ChatGPT Exporter ${VERSION}.${shortfall} Exported ${formatCreatedFrontmatter(now)} from ${window.location.href} -->`,
            clone.outerHTML
        ].join('\n');

        downloadFile(buildExportName('html', usableMoment(stamp) ? stamp : now), html, 'text/html');
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
        const inventory = conversationInventory();

        reportCompleteness(inventory);

        lines.push('---');

        // First in the block, deliberately. Where an export is short that is the
        // most important thing about the file, and a reader scanning the top
        // should meet it before the fields describing what it contains.
        //
        // Nothing goes in the document body: exporting several times and merging
        // them by hand is the only recovery available today, and a warning in the
        // prose would have to be cleaned out of every piece.
        if (inventory.verifiable && !inventory.complete) {
            lines.push('incomplete: true');
            lines.push(`turns_exported: ${inventory.loaded}`);

            // Two different keys rather than one, because they are two different
            // claims. `turns_in_conversation` says how long the conversation is
            // and is only written once the sentinel has cleared and that is known.
            // While ChatGPT still has pages to fetch, all that can honestly be
            // stated is how many turns the page has so far — a number that grows
            // as you scroll, and that a reader must not mistake for a length.
            if (inventory.totalIsFloor) lines.push(`turns_loaded: ${inventory.total}`);
            else lines.push(`turns_in_conversation: ${inventory.total}`);

            // The inventory counts containers, and a paginated-out turn has none.
            // So where ChatGPT still has more to fetch, the total above is a floor
            // rather than the count, and saying so costs one line.
            if (inventory.unfetched) lines.push('more_turns_unfetched: true');
        }

        lines.push(`created: ${created}`);

        // Kept separate from `created` rather than replacing it: one says when the
        // export ran, the other when the conversation began, and a reader has to be
        // able to tell them apart. Absent entirely when it cannot be established —
        // on a page whose URL carries no conversation id, such as a new chat
        // before ChatGPT has assigned one.
        if (started) lines.push(`conversation_started: ${formatCreatedFrontmatter(started)}`);

        lines.push(`title: "${escapeYamlString(chatTitle)}"`);
        lines.push(`source: "${escapeYamlString(url)}"`);

        // Which exporter wrote the file, so an export from before a fix can be told
        // apart from one after it.
        lines.push(`version: ${VERSION}`);
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

            const text = extractMessageText(content, role === 'user');

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
    // The stamp is a second, separate argument: the moment the filename is stamped
    // with, which the preview can set to when the conversation started. It touches
    // the name and nothing else — `created`, and the HTML export's provenance
    // comment, always say when the export was actually made. Absent, the name is
    // stamped with that moment, as it always was.
    //
    // Guarded rather than defaulted, because these are also click handlers: an
    // unguarded parameter would silently receive a MouseEvent. Duck-typed rather
    // than `instanceof Date`, which answers no for a date built in another realm or
    // before something replaced the global — both of which look exactly like the
    // caller passing nothing.
    function usableMoment(value) {
        return value && typeof value.getTime === 'function' && !isNaN(value.getTime());
    }

    function exportMarkdown(moment, stamp) {
        const now = usableMoment(moment) ? moment : new Date();
        const markdown = buildMarkdown(now);
        if (!markdown) return;

        downloadFile(buildExportName('md', usableMoment(stamp) ? stamp : now), markdown, 'text/markdown');

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

        // The moment the filename is stamped with. The export moment by default; the
        // toggle below can swap in when the conversation started.
        let stamp = now;

        const name = document.createElement('div');
        name.textContent = buildExportName('md', stamp);
        name.style.cssText = [
            'font-size:12px',
            `color:${muted}`,
            'overflow:hidden',
            'text-overflow:ellipsis',
            'white-space:nowrap'
        ].join(';');

        const nameGroup = document.createElement('div');
        nameGroup.style.cssText = 'display:flex;align-items:center;gap:10px;min-width:0';
        nameGroup.appendChild(name);

        // A chat held open for hours is better identified by when it began than by
        // when it was exported, so the preview offers that stamp instead. Offered
        // only where the address holds a conversation id to read it from, off every
        // time the preview opens, and never remembered: the script keeps no state,
        // and the export time stays the default.
        const started = conversationStarted();
        if (started) {
            const toggle = document.createElement('label');
            toggle.title = `The conversation started ${formatCreatedFrontmatter(started)}`;
            toggle.style.cssText = [
                'flex:none',
                'display:flex',
                'align-items:center',
                'gap:4px',
                'font-size:12px',
                `color:${muted}`,
                'cursor:pointer',
                'white-space:nowrap'
            ].join(';');

            const box = document.createElement('input');
            box.type = 'checkbox';
            box.style.cssText = 'margin:0;cursor:pointer';
            box.addEventListener('change', () => {
                stamp = box.checked ? started : now;
                name.textContent = buildExportName('md', stamp);
            });

            toggle.appendChild(box);
            toggle.appendChild(document.createTextNode('Stamp with conversation start'));
            nameGroup.appendChild(toggle);
        }

        // The version the export below carries in its frontmatter, so what is
        // previewed says the same as what downloads.
        const version = document.createElement('div');
        version.textContent = `v${VERSION}`;
        version.title = `ChatGPT Exporter ${VERSION}`;
        version.style.cssText = ['flex:none', 'font-size:12px', `color:${muted}`, 'white-space:nowrap'].join(';');
        nameGroup.appendChild(version);

        // The header's controls are all text buttons of one shape. The rail's
        // icon-over-label tiles suit its column, but in a row beside a text
        // button they stood nine pixels taller and read as a different kind of
        // thing.
        const textButton = (label, ariaLabel, handler) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.textContent = label;
            if (ariaLabel) button.setAttribute('aria-label', ariaLabel);
            button.style.cssText = [
                'flex:none',
                'padding:4px 10px',
                'border-radius:6px',
                'cursor:pointer',
                'font:inherit',
                `border:1px solid ${border}`,
                'background:transparent',
                `color:${text}`
            ].join(';');
            button.addEventListener('click', handler);
            return button;
        };

        // Escape and clicking away both work, but neither announces itself. A
        // visible control is the only dismissal a first-time user can see.
        const close = textButton('Close', null, closePreview);

        // Both are handed the moment the header was built from, and the stamp the
        // toggle has chosen, so pressing one here writes the file whose name is on
        // display beside it — deriving a fresh moment would rename the file out
        // from under the label.
        //
        // The overlay stays open afterwards: both formats are plausibly wanted from
        // one reading, and closing would remove the thing being checked.
        const actions = document.createElement('div');
        actions.style.cssText = 'display:flex;align-items:center;gap:6px;flex:none';
        actions.appendChild(textButton('.md', 'Export the conversation as Markdown', () => exportMarkdown(now, stamp)));
        actions.appendChild(textButton('.html', 'Export the conversation markup as HTML', () => exportHtml(now, stamp)));
        actions.appendChild(close);

        header.appendChild(nameGroup);
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
        // A column rather than a row: the dot sits above the count instead of
        // beside it. Inline, the dot and its gap leave the count 23px of the
        // rail's 34, and `8/20` measures 23.9px — so the rendering that says how
        // much is missing does not fit next to the dot, and moving the dot buys
        // the 11px it needs for 13px of rail height.
        const status = document.createElement('div');
        status.setAttribute('data-exporter-status', '');
        status.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:3px;cursor:default;user-select:none';

        const dot = document.createElement('span');
        dot.style.cssText = `width:7px;height:7px;border-radius:999px;background:${READY};flex:none`;
        status.appendChild(dot);

        const count = document.createElement('span');
        count.setAttribute('data-exporter-count', '');

        // Past about a hundred turns `x/y` outgrows the rail and widens it by a
        // few pixels. That is survivable; `8 /` wrapping above `20` is not, and
        // one declaration is the whole difference.
        count.style.cssText = `font-size:11px;font-weight:700;line-height:1;white-space:nowrap;color:${TEXT}`;
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
        const inventory = conversationInventory();
        const turns = inventory.loaded;

        // `x/y` only where the shortfall is actually known. A layout with no
        // inventory keeps the bare count it has always shown, rather than a
        // fraction invented out of the one number available.
        const short = inventory.verifiable && !inventory.complete;

        // The trailing `+` is what stops `5/10` being a lie. While ChatGPT still
        // has pages to fetch, the number after the slash is what the page holds so
        // far and grows as you scroll — on a 40-turn conversation it reads 10 on a
        // fresh load. One character says "at least" and costs 6px of the rail.
        const label = !turns ? ''
            : short ? `${inventory.loaded}/${inventory.total}${inventory.totalIsFloor ? '+' : ''}`
                : String(turns);

        const count = panel.querySelector('[data-exporter-count]');
        const status = panel.querySelector('[data-exporter-status]');

        // A bare `8/20` says something is wrong without saying what, so the
        // explanation goes where a reader will look for it rather than in a
        // console line they have no reason to open.
        const hint = !turns ? ''
            : short
                ? `${inventory.loaded} of ${inventory.totalIsFloor ? 'at least ' : ''}${inventory.total} turns loaded` +
                  ' — scroll to the top to load the rest'
                : `${turns} conversation turn${turns === 1 ? '' : 's'}`;

        // Only write when it actually changed. This runs from a MutationObserver
        // watching the whole subtree, and replacing the text node is itself a
        // mutation — assigning unconditionally would retrigger the observer and
        // leave the rail updating itself forever.
        if (count.textContent !== label) count.textContent = label;
        if (status.title !== hint) status.title = hint;

        // Take the count out of the layout entirely when empty. An empty span is
        // still a flex item, so the column's gap would still be applied and would
        // leave the dot sitting above a few pixels of nothing.
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

    // A namespaced handle on window, so a later paste of this file can find the
    // instance already running on the page and dispose it. ChatGPT's CSP blocks
    // fetching or eval'ing an update, so re-pasting is the only way to load new
    // code — and on a logged-out conversation a page reload would lose the chat, so
    // re-pasting onto the live page is a real workflow rather than an edge case.
    const GLOBAL_KEY = '__chatgptExporter';

    // Returns true when it replaced an instance a previous paste left running,
    // false on a first load — the caller reports which happened.
    function installPanel() {
        // Dispose the previous paste's instance first, so the page ends up with
        // exactly one rail wired to this code and one set of observers, rather than
        // a stale rail whose buttons still call the old code and a second set of
        // observers stacked on top.
        const previous = window[GLOBAL_KEY];
        const reloaded = !!(previous && typeof previous.teardown === 'function');
        if (reloaded) previous.teardown();

        syncPanel();

        // Coalesce bursts of mutation — streaming a reply fires these continuously,
        // and the check only needs to run once things settle.
        let pending = 0;
        const schedule = () => {
            clearTimeout(pending);
            pending = setTimeout(syncPanel, 300);
        };

        const bodyObserver = new MutationObserver(schedule);
        bodyObserver.observe(document.body, { childList: true, subtree: true });

        // Switching theme changes attributes on the root element and need not touch
        // the body's children at all, so the observer above can miss it entirely.
        const rootObserver = new MutationObserver(schedule);
        rootObserver.observe(document.documentElement, {
            attributes: true,
            attributeFilter: ['class', 'style', 'data-theme', 'data-chat-theme']
        });

        // And the operating system's preference, for the case where the page is
        // following it rather than declaring its own.
        const media = matchMedia('(prefers-color-scheme: dark)');
        media.addEventListener('change', schedule);

        // Everything this instance leaves on the page, gathered so the next paste
        // removes all of it: the pending timer, both observers, the media listener,
        // any open preview and its key handler, and the rail itself.
        window[GLOBAL_KEY] = {
            teardown() {
                clearTimeout(pending);
                bodyObserver.disconnect();
                rootObserver.disconnect();
                media.removeEventListener('change', schedule);
                closePreview();
                document.getElementById(PANEL_ID)?.remove();
            }
        };

        return reloaded;
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

    const reloaded = installPanel();

    // The value this evaluates to is what a console prints after a paste, and for
    // that path it is the only confirmation anything happened — an IIFE returning
    // nothing prints `undefined`, which reads like failure. It also says whether
    // this paste replaced a running instance, which is the confirmation the live
    // re-paste workflow needs.
    //
    // Returned rather than logged on purpose. Under a userscript manager this file
    // runs on every page view, where a log line each time would be noise, while an
    // unread completion value costs nothing.
    const ready = findTurns().length;
    const turns = ready ? `${ready} turn${ready === 1 ? '' : 's'}` : 'no conversation';
    return `ChatGPT Exporter ${reloaded ? 'reloaded' : 'ready'} — ${turns}`;
})();