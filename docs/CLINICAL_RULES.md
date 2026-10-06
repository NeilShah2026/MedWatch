# Clinical rules — a guide for clinical reviewers

> **Status: every rule file is `PLACEHOLDER_REQUIRES_CLINICAL_REVIEW`.** The rules in this
> repository are short, original, illustrative examples written for a demo. They are **not**
> taken from the AGS Beers Criteria, First Databank, Lexicomp or any other licensed source, and
> they are not complete. A licensed clinician must review, rewrite and approve them before
> MedWatch is used with real patients.

MedWatch never decides anything clinical. Rules only decide **which prompts a nurse sees for
review**. Every flag ends with "For clinician review."

You can review and edit the rules without reading code. They are four plain JSON files in
`/rules`. Each has a matching JSON Schema in `/rules/schemas`, so an editor such as VS Code will
underline mistakes as you type. The app validates every file when it starts. If a file is
invalid, the app stops with a message naming the file, the rule and the problem.

## Common fields (every rule)

| Field         | Meaning                                                                                             |
| ------------- | --------------------------------------------------------------------------------------------------- |
| `id`          | Stable identifier, e.g. `risk.opioid`. Never reuse an id for a different rule. Flags store this id. |
| `version`     | `MAJOR.MINOR.PATCH`. Bump it whenever you change the rule.                                          |
| `status`      | `PLACEHOLDER_REQUIRES_CLINICAL_REVIEW` or `CLINICIAN_APPROVED`.                                     |
| `description` | What the rule is about, for reviewers.                                                              |
| `source_note` | Where the content comes from (citation, guideline, local policy).                                   |
| `severity`    | `low`, `medium` or `high`: how prominent the resulting flag is.                                     |

Each file also has a top-level `status` and `version`. The app shows rules as placeholders until
**every** file and every rule says `CLINICIAN_APPROVED`.

## `drug_classes.json`

The list of drug classes that nurses choose from when they add a medicine (plus "Other"). Every
other file can only refer to classes listed here.

```json
{ "code": "sedative_hypnotic", "label": "Sleep medicine (sedative-hypnotic)" }
```

## `medication_risks.json` → "Medication risk" flags

One flag per patient per rule when any active medicine has the rule's `drug_class`.

| Field             | Meaning                                                                                            |
| ----------------- | -------------------------------------------------------------------------------------------------- |
| `drug_class`      | The class that triggers the rule.                                                                  |
| `title`           | Short flag title shown in lists.                                                                   |
| `risk_summary`    | One or two plain-language sentences shown to nurses and caregivers.                                |
| `min_days_active` | Optional. Only flag after the medicine has been active this many days (use for "long-term" rules). |

A flag that a nurse has reviewed (acknowledged, dismissed or escalated) is not raised again for
the same set of medicines. Adding another medicine of that class raises a new flag.

## `interactions.json` → "Interaction" flags

A rule matches when one active medicine is in `group_a` and a **different** active medicine is in
`group_b`. Use the same list in both groups for "two or more of these" rules (for example, two
medicines that cause sleepiness).

| Field                   | Meaning                    |
| ----------------------- | -------------------------- |
| `group_a`, `group_b`    | Lists of drug class codes. |
| `title`, `risk_summary` | As above.                  |

## `side_effect_associations.json` → "Temporal correlation" flags and check-in questions

Maps a drug class to symptoms that may follow starting it or changing its dose, with a typical
onset window in days.

```json
{
  "drug_class": "sedative_hypnotic",
  "symptoms": [
    { "symptom_code": "dizziness", "typical_onset_days_min": 1, "typical_onset_days_max": 14 }
  ]
}
```

`symptom_code` must be one of the 20 codes in the symptom catalog
(`packages/core/src/catalog.ts`, mirrored in the database).

This file is used in two places:

1. **Tailored check-in.** Each patient's daily check-in asks about the four core symptoms (falls,
   confusion, dizziness, shortness of breath) plus the symptoms linked to their medicines' classes,
   up to 10 questions.
2. **Temporal correlation flags.** When a symptom is **new** (not reported in the prior 7 days) or
   **worse** (at least one step higher than the prior 7-day maximum), MedWatch looks for medicine
   changes 1–14 days earlier (starts, dose changes and schedule changes) and scores each one:

| Evidence                                                                     | Points |
| ---------------------------------------------------------------------------- | ------ |
| The class lists this symptom and the day falls in the onset window           | +3     |
| The class lists this symptom but the timing is outside the window            | +1     |
| At least 80% of that medicine's doses since the change were reported taken   | +2     |
| More than half of those doses were reported missed (the explanation says so) | −2     |
| Symptom severity is 2 ("some") or 3 ("a lot")                                | +1     |
| The symptom is a fall/near-fall or confusion                                 | +1     |

The highest-scoring change is used: a score of 6 or more is **high**, 4–5 is **medium**, 2–3 is
**low**, and below 2 produces no flag. The other changes in the window are kept as evidence.
These numbers live in `packages/core/src/flags.ts` (`SCORE`) and are also placeholders for
clinical review.

## Adherence flags (no rule file)

Raised when a scheduled medicine's reported adherence over the last 7 days is below 70% (with at
least 3 doses recorded), or when 3 or more doses in a row were reported missed. Below 50% the flag
is **high**. Otherwise it is **medium**.

## Wording rules

Rule text must never diagnose or recommend treatment. The loader rejects any rule whose `title`
or `risk_summary` contains these phrases: _diagnose, diagnosis, stop taking, reduce dose, increase
dose, you have, you should take, prescribe_. Describe what kind of risk the medicine carries, not
what anyone should do about it.

## Approving a rule file

1. Review every rule. Edit the text, windows and severities, and update `source_note` with your
   source.
2. Bump each changed rule's `version`, and the file's `version`.
3. Set `status` to `CLINICIAN_APPROVED` on the rules you approve and on the file.
4. Run `npm run test`. The loader and wording tests must pass.
5. Record the reviewer, date and scope of the review in your change request.
