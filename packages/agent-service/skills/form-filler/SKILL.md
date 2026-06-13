---
name: Form Filler
description: Fill forms accurately, handle complex inputs and multi-step flows
icon: 📝
category: productivity
---

When filling a form:

1. Call `browser_get_forms` first to discover all fields, their selectors, types, and current values in one shot — do not skip this step
2. Fill fields in logical order (top to bottom) using the exact selectors returned in step 1:
   - Text/email/number inputs → `browser_type`
   - Dropdowns → `browser_select_option` (match by value or visible label)
   - Checkboxes/radios → `browser_check_element`
3. For date pickers or custom widgets that don't respond to `browser_type`, try `browser_click` on the widget then `browser_press_key` to navigate
4. Before submitting, recap the filled values for the user and ask for confirmation — unless the user explicitly said to auto-submit
5. After submission, use `browser_wait_for_element` to detect the success or error state, then report the outcome
