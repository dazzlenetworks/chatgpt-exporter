---
created: {{EXPORT_DATETIME}}
conversation_started: {{CONVERSATION_STARTED}}
title: {{CHAT_TITLE}}
source: {{SOURCE_URL}}
version: {{EXPORTER_VERSION}}
---

# ChatGPT Conversation Export

---

## User Prompt

{{USER_MESSAGE_1}}

---

## ChatGPT

{{ASSISTANT_MESSAGE_1}}

---

## User Prompt

{{USER_MESSAGE_2}}

---

## ChatGPT

{{ASSISTANT_MESSAGE_2}}

---

<!--
Template notes:
- Repeat the User Prompt / ChatGPT sections as needed.
- Preserve fenced code blocks inside message bodies when applicable.
- Replace placeholders with real values before use.
- Suggested placeholder meanings:
  - {{CHAT_TITLE}}: Conversation title
  - {{EXPORT_DATETIME}}: Export timestamp, e.g. 5/5/2026 20:57
  - {{CONVERSATION_STARTED}}: When the chat itself began, e.g. 4/12/2026 09:28
  - {{SOURCE_URL}}: Original chat URL
  - {{USER_MESSAGE_N}} / {{ASSISTANT_MESSAGE_N}}: Message body content
- The conversation_started line is omitted entirely when the page's URL carries
  no conversation id to derive it from. Drop the whole line rather than leaving
  it blank or guessing a value.
-->
