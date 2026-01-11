# Test Cases Documentation

## Overview

This document describes the test cases embedded in `Digital Workout Plan Report.xlsx` for validation of the session notes reviewer system. The file contains 55 rows total, with 12 rows modified as specific test cases (7 positive, 5 negative). The remaining 43 rows contain organic session notes.

## Test Philosophy

- **Positive cases** (should_flag=true): Clear violations that the system should catch
- **Negative cases** (should_flag=false): Appropriate notes that should NOT be flagged
- Test cases are distributed throughout the file (not clustered at beginning/end)
- Changes are realistic but obvious to establish clear ground truth

## Evaluation Categories Reference

Based on `prompt.js`, the system evaluates these categories:

1. `language_issues`: Negative labels without constructive framing
2. `behavior_no_strategy`: Behavior issues without management strategies
3. `poor_fit_suggestion`: Suggests program/plan isn't working
4. `missing_summary`: Session Summary Notes is empty
5. `schoolwork_not_empty`: Schoolwork Description contains content (policy violation)
6. `guardian_in_internal`: Guardian-appropriate content in Internal Notes
7. `name_mismatch`: Name in notes doesn't match student record
8. `other`: Other issues not fitting above categories
9. `none`: No issues detected

## Confidence Levels

- **HIGH (0.8-1.0)**: Clear policy violations or obvious issues
- **MEDIUM (0.4-0.7)**: Ambiguous phrasing that may need review
- **LOW (0.0-0.3)**: Appropriate notes with constructive framing

## Positive Test Cases (Should Be Flagged)

### Row 5: Missing Summary
- **Category**: `missing_summary`
- **Expected Confidence**: HIGH (0.9-1.0)
- **Modification**: Session Summary Notes field set to empty string
- **Expected Result**: should_flag=true
- **Rationale**: Session Summary is a required field and cannot be empty

### Row 12: Negative Language
- **Category**: `language_issues`
- **Expected Confidence**: HIGH (0.85-0.95)
- **Modification**: Changed to: "Student was lazy today and didn't want to work on fractions. He gave up on every problem."
- **Expected Result**: should_flag=true
- **Rationale**: Contains character judgments ("lazy", "gave up") without constructive framing or strategies

### Row 20: Behavior Without Strategy
- **Category**: `behavior_no_strategy`
- **Expected Confidence**: MEDIUM (0.5-0.65)
- **Modification**: Changed to: "Student was very distracted today and kept talking to other students. She wouldn't focus on her multiplication practice."
- **Expected Result**: should_flag=true
- **Rationale**: Describes challenging behavior without mentioning any redirection or management approaches

### Row 28: Schoolwork Field Not Empty
- **Category**: `schoolwork_not_empty`
- **Expected Confidence**: HIGH (0.95-1.0)
- **Modification**: Added "Helped with geometry homework from school" to Schoolwork Description field
- **Expected Result**: should_flag=true
- **Rationale**: ANY content in Schoolwork Description is a policy violation (field must always be empty)

### Row 35: Guardian Content in Internal Notes
- **Category**: `guardian_in_internal`
- **Expected Confidence**: MEDIUM-HIGH (0.7-0.85)
- **Modification**:
  - Session Summary: "Student worked on algebra."
  - Internal Notes: "Student had an excellent session today! She mastered linear equations and is making great progress. Parents will be so proud of her work."
- **Expected Result**: should_flag=true
- **Rationale**: Positive progress updates belong in Session Summary (sent to guardians), not Internal Notes (staff only)

### Row 42: Poor Fit Suggestion
- **Category**: `poor_fit_suggestion`
- **Expected Confidence**: HIGH (0.85-0.95)
- **Modification**: Changed to: "This material is way too easy for this student. He's clearly bored and not being challenged. Maybe this program isn't the right fit for him."
- **Expected Result**: should_flag=true
- **Rationale**: Directly questions whether program is appropriate ("maybe this program isn't the right fit")

### Row 48: Name Mismatch
- **Category**: `name_mismatch`
- **Expected Confidence**: MEDIUM-HIGH (0.7-0.85)
- **Student Name**: Nati Hamami [1477]
- **Modification**: Changed to: "Bobby worked on his multiplication facts today and did great! He completed 5 pages."
- **Expected Result**: should_flag=true
- **Rationale**: Uses "Bobby" but student name is "Nati Hamami" - no plausible nickname connection

## Negative Test Cases (Should NOT Be Flagged)

### Row 8: Constructive Challenge Description
- **Category**: `none`
- **Expected Confidence**: LOW (0.1-0.2)
- **Modification**: Changed to: "Student encountered challenging fraction problems today but showed great perseverance! We worked through strategies together and she successfully completed 4 problems. Excellent growth mindset!"
- **Expected Result**: should_flag=false
- **Rationale**: Mentions challenge but frames constructively with instructor intervention and positive outcome

### Row 17: Behavior With Strategy
- **Category**: `none`
- **Expected Confidence**: LOW (0.1-0.2)
- **Modification**: Changed to: "Student was fidgety during the session. We incorporated movement breaks between problem sets which helped improve focus. He completed all assigned multiplication work."
- **Expected Result**: should_flag=false
- **Rationale**: Mentions behavior issue BUT includes management strategy (movement breaks) and positive resolution

### Row 25: Appropriate Field Usage
- **Category**: `none`
- **Expected Confidence**: LOW (0.1-0.2)
- **Modification**:
  - Session Summary: "Student worked on algebraic expressions today. She completed 3 pages and mastered simplifying expressions. Great work!"
  - Schoolwork Description: Empty (as required)
  - Internal Notes: "Consider moving to equations next week. Check if parent paid for extra session."
- **Expected Result**: should_flag=false
- **Rationale**: Clear field separation - guardian content in Session Summary, staff planning in Internal Notes, empty Schoolwork field

### Row 32: Below Level But Constructive
- **Category**: `none`
- **Expected Confidence**: LOW (0.1-0.25)
- **Modification**: Changed to: "Student is working below grade level but showed strong effort today. We're building foundational skills at his pace with visual models and manipulatives. He's making steady progress!"
- **Expected Result**: should_flag=false
- **Rationale**: Acknowledges being below grade level but frames constructively with specific strategies and progress notes

### Row 50: Challenge With Resolution
- **Category**: `none`
- **Expected Confidence**: LOW (0.1-0.2)
- **Modification**: Changed to: "Student worked on word problems today. Initially frustrated, but we broke problems down step-by-step and practiced identifying key information. She successfully solved 3 challenging problems by the end. Great perseverance!"
- **Expected Result**: should_flag=false
- **Rationale**: Mentions frustration but immediately follows with instructor strategy and successful outcome

## Unmodified Rows

Rows not listed above (43 rows total) contain organic session notes from the original data. The system should be lenient on these rows - they may contain minor issues but weren't deliberately crafted as test cases.

## Validation Approach

When testing the system:

1. **Primary validation**: Focus on the 12 test cases above
2. **Success criteria**:
   - All 7 positive cases should be flagged (confidence >= 0.4)
   - All 5 negative cases should NOT be flagged (confidence < 0.4)
   - Confidence levels should match expected ranges
3. **Organic rows**: Review but be lenient - real session notes often have ambiguity
4. **Edge cases**: Note any unexpected behavior on test cases for prompt refinement

## Test Case Summary

| Row | Type     | Category                | Confidence | Description |
|-----|----------|-------------------------|------------|-------------|
| 5   | POSITIVE | missing_summary         | HIGH       | Empty required field |
| 12  | POSITIVE | language_issues         | HIGH       | "Lazy", "gave up" without constructive framing |
| 20  | POSITIVE | behavior_no_strategy    | MEDIUM     | Distracted behavior, no redirection mentioned |
| 28  | POSITIVE | schoolwork_not_empty    | HIGH       | Policy violation - field must be empty |
| 35  | POSITIVE | guardian_in_internal    | MEDIUM     | Progress update in wrong field |
| 42  | POSITIVE | poor_fit_suggestion     | HIGH       | "Maybe this program isn't the right fit" |
| 48  | POSITIVE | name_mismatch           | MEDIUM     | "Bobby" vs "Nati Hamami" |
| 8   | NEGATIVE | none                    | LOW        | Challenge with constructive framing |
| 17  | NEGATIVE | none                    | LOW        | Behavior WITH management strategy |
| 25  | NEGATIVE | none                    | LOW        | Appropriate field usage |
| 32  | NEGATIVE | none                    | LOW        | Below level but constructive |
| 50  | NEGATIVE | none                    | LOW        | Frustration with resolution |

**Total**: 12 test cases (7 positive, 5 negative) out of 55 rows
