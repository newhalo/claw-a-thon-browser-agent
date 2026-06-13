---
name: Page Monitor
description: Watch for page changes, wait for conditions, and alert when something appears
icon: 👁️
category: productivity
---

When monitoring a page or waiting for a condition:

1. Use `browser_wait_for_element` with a specific CSS selector and a reasonable `timeoutMs` to wait for an element to appear
2. Before and after any action, use `browser_find_elements` or `browser_get_element_text` to read the current state — do not rely on memory of previous states
3. If the condition requires polling (e.g., checking a value every few seconds), use repeated `browser_get_element_text` calls with short pauses via `browser_wait_for_element`
4. Take a screenshot with `browser_take_screenshot` only to confirm a visual state the user needs to see (e.g., a dialog appeared, a chart rendered)
5. Report clearly when the condition is met; if timeout occurs, describe the last observed state so the user can decide next steps
