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

        if (!pageTitle || /^chatgpt$/i.test(pageTitle)) {
            return 'Untitled chat';
        }

        return pageTitle;
    }

    function cleanText(text) {
        return text
            .replace(/\u200b/g, '') // zero-width chars
            .replace(/\n{3,}/g, '\n\n')
            .trim();
    }

    function extractCodeBlocks(container) {
        const clone = container.cloneNode(true);

        clone.querySelectorAll('pre').forEach(pre => {
            const codeEl = pre.querySelector('code');
            const code = (codeEl?.innerText || pre.innerText || '').trim();

            let lang = '';
            const className = codeEl?.className || '';
            const match = className.match(/language-([\w]+)/);
            if (match) lang = match[1];

            const replacement = `\n\`\`\`${lang}\n${code}\n\`\`\`\n`;
            pre.replaceWith(replacement);
        });

        return clone;
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
                const text = cleanText(blockquote.innerText || '');
                if (!text) {
                    blockquote.remove();
                    return;
                }

                const quoted = text
                    .split('\n')
                    .map(line => `> ${line}`)
                    .join('\n');

                blockquote.replaceWith(`\n${quoted}\n`);
            });

            return container;
        }

        function extractMessageText(container) {

        if (!container) return '';

                const processed = extractCodeBlocks(container);
        stripNoise(processed);
        extractBlockquotes(processed);


        // Replace image-like content with placeholders so the export remains readable.
        processed.querySelectorAll('img, canvas').forEach(() => {
            const placeholder = document.createTextNode('[Image]');
            processed.appendChild(placeholder);
        });

        return cleanText(processed.innerText);
    }

    // Conversation turns are identified by ChatGPT's author-role attribute.
    const turns = document.querySelectorAll('[data-message-author-role]');
    const lines = [];


        const title = 'ChatGPT Conversation Export';
    const now = new Date();
    const created = formatCreatedFrontmatter(now);
    const filenameTimestamp = formatFilenameTimestamp(now);


    const chatTitle = getChatTitle();
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
        const role = turn.getAttribute('data-message-author-role');

        let sender = 'Unknown';
        if (role === 'user') sender = 'User Prompt';
        if (role === 'assistant') sender = 'ChatGPT';

        // Try likely message body containers used by the current ChatGPT UI.
        const content =
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