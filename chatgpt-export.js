(() => {
    function formatDate(date = new Date()) {
        return date.toISOString().split('T')[0];
    }

    function formatDateTime(date = new Date()) {
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
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
        // Remove common UI elements
        container.querySelectorAll([
            'button',
            'svg',
            'form',
            'nav',
            '[role="button"]',
            '[aria-label="Copy"]'
        ].join(',')).forEach(el => el.remove());

        return container;
    }

    function extractMessageText(container) {
        if (!container) return '';

        const processed = extractCodeBlocks(container);
        stripNoise(processed);

        // Replace images with placeholders
        processed.querySelectorAll('img, canvas').forEach(() => {
            const placeholder = document.createTextNode('[Image]');
            processed.appendChild(placeholder);
        });

        return cleanText(processed.innerText);
    }

    // ✅ Modern selector strategy (2026-safe)
    const turns = document.querySelectorAll('[data-message-author-role]');
    const lines = [];


    const title = "ChatGPT Conversation Export";
    const now = new Date();
    const date = formatDate(now);
    const dateTime = formatDateTime(now);
    const filenameTimestamp = formatFilenameTimestamp(now);

    const chatTitle = getChatTitle();
    const url = window.location.href;


    lines.push(`# ${title}\n`);
    lines.push(`**Title:** ${chatTitle}`);
    lines.push(`**Date:** ${dateTime}`);

    lines.push(`**Source:** ${url}`);

    lines.push('\n---\n');

    turns.forEach(turn => {
        const role = turn.getAttribute('data-message-author-role');

        let sender = 'Unknown';
        if (role === 'user') sender = 'User Prompt';
        if (role === 'assistant') sender = 'ChatGPT';

        // Message content container (more resilient search)
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

    console.log("Export complete.");
})();