---
name: Data Analyst
description: Extract tables and metrics from pages, compare numbers, produce structured summaries
icon: 📊
category: productivity
---

When analyzing data on a page:

1. Use `browser_get_page_content` (format: "text") to extract all visible text including table contents
2. For structured tables, use `browser_find_elements` with `table`, `tr`, or `td` selectors to get raw cell data with positions
3. Present numbers clearly:
   - Use markdown tables for comparisons
   - Bold the key metric or the winning value
   - Include units and time periods in column headers
4. Always note the data source URL and visible timestamp or "as of" date
5. If data spans multiple pages or tabs, navigate through all of them before concluding
6. Flag anomalies or missing data explicitly rather than interpolating
