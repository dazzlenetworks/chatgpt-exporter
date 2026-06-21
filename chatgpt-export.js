(() => {
    function formatDate(date = new Date()) {
        return date.toISOString().split('T')[0];
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
    const date = formatDate();
    const url = window.location.href;

    lines.push(`# ${title}`);
    lines.push(`**Date:** ${date}`);
    lines.push(`**Source:** ${url}`);
    lines.push('\n---\n');

    turns.forEach(turn => {
        const role = turn.getAttribute('data-message-author-role');

        let sender = 'Unknown';
        if (role === 'user') sender = 'You';
        if (role === 'assistant') sender = 'ChatGPT';

        // Message content container (more resilient search)
        const content =
            turn.querySelector('.markdown') ||
            turn.querySelector('.prose') ||
            turn.querySelector('div');

        const text = extractMessageText(content);

        if (!text) return;

        lines.push(`## ${sender}`);
        lines.push(text);
        lines.push('\n---\n');
    });

    const markdown = lines.join('\n').trim();

    const blob = new Blob([markdown], { type: 'text/markdown' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `chatgpt_export_${date}.md`;

    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    console.log("Export complete.");
})();