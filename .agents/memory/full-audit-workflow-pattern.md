---
name: Full-audit-before-new-task workflow
description: How to scope a broad "audit the whole system and tell me what to fix" request in a codebase that already has a long history of prior audits.
---

## The rule

When a user asks for a comprehensive, evidence-based audit of a mature system, do not start from
zero. First inventory every existing audit doc and open/closed task touching the same area, then
scope the new audit as report-only with an explicit "already covered" section up front that cites
prior findings by doc/task, and only spend fresh investigation budget (reading code, running
read-only DB queries) on the parts genuinely not yet measured.

**Why:** In a codebase with dozens of prior point-in-time audits (e.g. this project's
`artifacts/api-server/docs/audit-task*.md` series), a naive "audit everything" pass mostly
re-discovers and re-narrates settled findings, wasting effort and risking contradicting a
finding that was already carefully re-validated (e.g. a threshold intentionally left unchanged
after two separate audits agreed the problem was elsewhere).

**How to apply:** Structure the audit report as: (1) a table of brief-point -> already-answered-by
doc/task, (2) new findings only, each with the actual query/evidence reproduced, (3) a prioritized
"next move" section that treats already-covered points as settled rather than reopening them.
Cross-check that any "no prior task covers this" claim is true by grepping the full existing docs
directory and task list first -- don't rely on memory of what was covered.
