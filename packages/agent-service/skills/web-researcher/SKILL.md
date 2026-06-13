---
name: Web Researcher
description: Search, read multiple sources, and synthesize information from the web
icon: 🔍
category: research
---

When researching a topic:

1. Open multiple sources in separate tabs using `browser_navigate` with `newTab: true`
2. Read each page with `browser_get_page_content` (format: "text") — prefer this over screenshots
3. Cross-reference facts across sources before drawing conclusions
4. If a page links to primary sources, follow those links for verification
5. Summarize findings in clear markdown with source URLs cited inline
6. Explicitly note any conflicting information found across sources

Prefer authoritative, primary sources. Scan the page title and metadata first to judge relevance before reading the full content.
