# Review Categories

Each session record is classified into one of these issue categories. The category
drives the email subject line and how urgently the CD should act.

---

## `missing_math_detail`
**What it means:** Session Summary Notes names no specific math concept. Broad topic areas alone ("fractions", "algebra") are not sufficient — the note must name a specific skill.
**Minimum bar:** "Combining like terms" ✓, "comparing fractions with unlike denominators" ✓, "area of composite figures" ✓. "Fractions" alone ✗, "multiplication" alone ✗.
**Action:** Coach the instructor on naming specific concepts. The note doesn't need to be long — just name what was worked on.

---

## `sentiment_mismatch`
**What it means:** The tone is disproportionately positive relative to what the note describes. Triggered by: (1) 0–3 pages completed AND strongly positive framing with no explanation; (2) note describes significant errors throughout but closes with strong positive language that contradicts the substance.
**Not triggered by:** Notes where depth of work explains low page count; mastery check sessions (1–2 pages expected); notes with mild positive closings after genuine difficulty.
**Action:** Ask the instructor to be more specific about what happened if the session was challenging, or to moderate the closing if it doesn't reflect what was described.

---

## `missing_summary`
**What it means:** Session Summary Notes is empty or near-empty.  
**Why it matters:** This field is sent directly to guardians. An empty note means
parents receive no communication about what their child worked on.  
**Action:** Contact the instructor. Have them fill in the note before the next session,
or submit it now if the student is still active.

---

## `language_issues`
**What it means:** The note contains unprofessional language, negative framing, or
wording that would concern a parent. Examples: "lazy", "didn't want to try",
"refused to work", dismissive tone.  
**Why it matters:** These notes go to guardians verbatim and reflect the center's
professionalism.  
**Action:** Edit the note in Radius before it's visible to the guardian, and coach
the instructor on constructive framing.

---

## `schoolwork_not_empty`
**What it means:** The Schoolwork Description field contains content.  
**Why it matters:** Per Mathnasium policy, this field should always be left empty.
Content here indicates the instructor may be confused about which field to use.  
**Action:** Move the content to the appropriate field (Session Summary Notes or
Internal Notes) and clear Schoolwork Description.

---

## `behavior_no_strategy`
**What it means:** The note mentions a behavioral challenge (distraction, frustration,
lack of engagement) without describing what strategy was used to address it.  
**Why it matters:** Incomplete behavior notes don't help future instructors or parents
understand how to support the student. They also expose the center to questions like
"why wasn't anything done?"  
**Action:** Ask the instructor to add what they tried (short break, changed topic,
encouragement, etc.).

---

## `guardian_in_internal`
**What it means:** The Internal Notes field contains language clearly directed at
parents/guardians rather than staff.  
**Why it matters:** Internal Notes are for staff only and are not sent to guardians.
Parent-facing content belongs in Session Summary Notes.  
**Action:** Move the content to Session Summary Notes and clarify with the instructor
which field is which.

---

## `name_mismatch`
**What it means:** The student's name in the note doesn't match the name in the
student record, or there's an inconsistency that could indicate a data entry error.  
**Action:** Verify in Radius that the session was logged under the correct student.

---

## `poor_fit_suggestion`
**What it means:** The note suggests the student's current curriculum level may not
be appropriate ("this seems too easy/hard", "maybe they need something different").  
**Why it matters:** These are signals for a curriculum review, not routine notes.  
**Action:** Schedule a learning plan review for the student.

---

## `none`
**What it means:** No issues found. The note is well-written and appropriate.  
**Action:** None.

---

## `other`
**What it means:** Something unusual that doesn't fit the above categories but caught
the model's attention.  
**Action:** Read the justification and use judgment.

---

## Confidence Score

The confidence value (0.0–1.0) represents how certain the model is that the issue
is real. Items are only included in the email if confidence ≥ 0.4 (40%).

| Range | What it means |
|-------|---------------|
| 0.8–1.0 | Near-certain — almost always a real issue |
| 0.5–0.8 | Probable — review recommended |
| 0.4–0.5 | Borderline — use judgment |
| < 0.4 | Not surfaced in email |

Adjust `MIN_CONFIDENCE` in `.env` to raise or lower the threshold.
