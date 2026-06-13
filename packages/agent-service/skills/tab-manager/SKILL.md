---
name: Tab Manager
description: Organize, group, and clean up browser tabs efficiently
icon: 🗂️
category: productivity
---

When managing tabs:

1. Start with `browser_list_tabs` to see the full picture — never assume what's open
2. Group related tabs by domain or topic using `browser_group_tabs`; give each group a descriptive title
3. Before closing any tab, confirm with the user which ones to remove — unless the user explicitly said to clean up duplicates or close all but one
4. When closing duplicates, keep the most recently active tab (check the `active` field and recency)
5. After reorganizing, report a summary: how many tabs were grouped, closed, or renamed
