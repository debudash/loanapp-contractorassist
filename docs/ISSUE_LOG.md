# Issue log

Bugs found after a slice was merged. Each has a failing test written first, a comment at the fix site with its ID, and one commit with Issue / Root cause / Fix / Test. Findings from a slice's own review before merge are recorded in that slice's merge request instead.

| ID | Found by | Issue | Root cause | Fix | Test | Commit |
|---|---|---|---|---|---|---|
| ISS-1 | First live eval run | 21% of ordinary questions ended in the standard explanation | The prompt's own wording ("approved terms", numbered cards) and unchecked counts ("two offers") led the model to write words the guard blocks | Prompt avoids guarded words, lists cards by position word, asks for names instead of numbers or counts | `prompts.test.ts` | `f4a1efe` |
| ISS-2 | First live eval run | The meaning check failed true statements as "unsupported" | It never sees the terms text, and nothing told it accuracy isn't its job | Prompt limits it to decisions, steering, marketing and advice | `prompts.test.ts` | `e7a37e8` |
| ISS-3 | First live eval run | "about about $24,000" on screen | Rounded figures already say "about"; nothing stopped the model adding it | G-1 rejects "about" before a rounded placeholder; prompt says so | `guard.test.ts` | `3ab4d0f` |
| ISS-4 | First live eval run | The exact total was asked for, and a rounded total was given | The rule "rounded figures are for the spoken line" wasn't enforced | G-1 rejects a rounded placeholder in the answer; prompt says so | `guard.test.ts` | `38367ba` |
| ISS-5 | First live eval run | "Costs more than a shorter term" when the shorter promo costs more | The prompt allowed comparisons without naming the offers | Prompt asks for named comparisons, no generalising | `prompts.test.ts` | `39188aa` |
| ISS-6 | First live eval run | The grounding judge failed correct answers | It couldn't tell the spoken line was for the homeowner, and the facts didn't define the cliff | Judge input labelled by audience; every figure named by its meaning | `facts.test.ts` | `895f749` |
