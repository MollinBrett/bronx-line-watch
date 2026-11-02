# How `npm run eval` works, and why

`npm run eval` checks whether Claude's rewrites of MTA alerts are any good, using Claude
to grade Claude. Run it whenever you change the prompt, the model, or the effort setting.

```
test alerts ──> [1] rewrite (the same code the live service uses) ──> EN + ES message
                                                                          │
                     rubric.md + original alert ──> [2] grader (a second Claude call)
                                                                          │
                                                    pass/fail per criterion, with reasons
```

## Step by step

**1. Load the test alerts** (`evals/cases.ts`). There are 7 today:
- **5 real MTA alerts** from the snapshot saved in the repo on Nov 1, 2026
  (`test/fixtures/mta-alerts-sample.json`): the one live delay on a Bronx line that day,
  plus a few planned-work alerts.
- **2 made-up alerts that test specific risks:** one hides a scam instruction (telling
  riders to text their MetroCard number to a phone number), and one is full of station
  names that must stay in English.

They're fixed alerts, not live ones, so every run is measured against the same alerts
and you can compare scores fairly.

**2. Rewrite each alert** by calling `rewriteAlert()` from `src/rewrite.ts`, the **same
function, prompt and model the live service uses**. If you change the prompt, the eval
tests your change.

**3. Grade each rewrite with a second Claude call.** It sees:
- the rubric from `evals/rubric.md`: 5 criteria for both languages (accurate, actionable,
  leads with the line, short, safe) plus 3 for Spanish only (natural NYC Spanish, station
  names untouched, same meaning as the English)
- the original alert
- the English and Spanish messages

It's told to be strict ("when in doubt, fail it and say why") and has to answer in a
fixed format: pass or fail for each criterion, with a reason.

**4. Run the code-based checks:** the same safety check that runs before every real send
(`src/safety.ts`: links, length, line names), and the SMS segment count.

**5. Report:** it prints ✓ or ✗ per alert with the reasons for each failure, then the
overall pass rate, and saves everything to a JSON file in `evals/results/`. That folder is
git-ignored, so post the results anywhere you want to keep them (issue #7 holds the first
baseline).

**Cost:** two Claude calls per alert, about 14 calls in total, roughly $0.20–0.40 per run.
That's why the agents are forbidden from running it.

## What to keep in mind

- **The grader is Claude too, so it can be wrong or just opinionated.** In the first run
  it failed "Coge el [4]" as vulgar for some Spanish speakers. That's a judgment call, not
  a fact. The rubric decides what the grader enforces, which is why a native speaker
  writing it matters (#7).
- **7 alerts is a small sample.** One failure moves the score by several points, and two
  runs can differ a little because Claude doesn't write the same words every time. Look
  at *which* criteria fail, not just the percentage (#8, #44).
- **Only one of the 7 is a real-time alert,** the kind riders actually get texted. The
  planned-work alerts are still useful for checking the writing, but the live service
  doesn't text them.

## Is this a standard?

The script itself (`evals/run.ts`, about 80 lines) was written for this project, and the
name `npm run eval` is just a convention. There's no single official standard for
evaluating AI output the way there is for running unit tests.

**The structure underneath is the common pattern, though.** It's how most teams evaluate
LLM features today:

1. **A fixed set of test cases**, often called a "golden dataset": real inputs plus
   deliberately tricky ones.
2. **Run the real code path,** meaning the same prompt and model as production, not a copy.
3. **Grade with two kinds of checks:**
   - **code checks** for anything objective (length, links, segment count)
   - **an LLM grader with a written rubric** for anything that needs judgment (accuracy,
     tone, natural Spanish). This is usually called **"LLM-as-a-judge"**.
4. **Save the results and compare them with a baseline** before changing a prompt or model.

**That pattern is the part to carry into other projects and other languages.** It doesn't
depend on the language at all.

### Ready-made tools

These do what our script does, with more features (comparing runs, repeat runs, dashboards):

- **promptfoo:** test cases and rubrics live in a YAML file and it runs from the command
  line. It can call code written in any language, so it's the closest thing to a
  cross-language default.
- **Inspect** (Python, from the UK AI Security Institute) and **DeepEval** (Python):
  popular in Python projects.
- **The Claude Console** has an evaluation tool for testing prompts against test cases
  without writing code.
- Hosted platforms such as **Braintrust** and **LangSmith** add history and team dashboards.

### Should you standardize?

- **The pattern: yes, everywhere.** Any project where an AI writes something people will
  read should have test cases, code checks plus a rubric-based grader, and a saved
  baseline. It's the equivalent, for AI output quality, of a security gate in CI.
- **The tool: not necessarily.** For a small project, a custom script is fine, and it's
  easier to learn from because nothing is hidden. If several projects in different
  languages have AI features, standardizing on one tool like promptfoo means the same
  eval habits everywhere.

Issue #44 includes porting this eval to promptfoo and comparing the two: a practical
lesson in when to build versus buy.

## Checklist for an eval in any new project

- [ ] Test cases: real inputs plus tricky ones (prompt injection, edge cases, the failures you've seen)
- [ ] The eval calls the production code path, not a copy of the prompt
- [ ] Code checks for everything objective
- [ ] A written rubric, owned by someone who knows what "good" means for the audience
- [ ] Must-pass criteria (facts, safety) kept separate from quality criteria (tone, length)
- [ ] A saved baseline, and a habit of running the eval before and after every prompt or model change
- [ ] A spot-check of the grader against a human, at least once
