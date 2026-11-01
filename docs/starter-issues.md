# Starter issues

Each one becomes a GitHub issue. `mentee` issues are for a person; agents skip them.
They're roughly in order: each one teaches something the next builds on.

## Make the agents better (the main event)

1. **Write the real Spanish rubric** `mentee`
   `evals/rubric.md` criteria 6-8 are a non-native starter. Rewrite them as a native speaker: what makes a Bronx rider trust a text? Run `npm run eval` before and after, and compare. *Learn: writing down what "good" means is how you steer a model.*

2. **Grow the eval set from real life** `mentee`
   Add 10 real alerts to `evals/cases.ts` that the current prompt handles badly (watch `npm run once` for a week, or ride the 4). *Learn: evals built from real failures beat made-up ones.*

3. **Is Opus overkill? Prove it either way** `mentee`
   Run the eval with `CLAUDE_MODEL=claude-sonnet-5-5` and `claude-haiku-5-5`, and with `CLAUDE_EFFORT` at `low` vs `medium`. Report pass rate and cost per message, then recommend a default. *Learn: choose models with data, not vibes.*

4. **Answer the agents' paused approvals** `mentee`
   When an agent's tool call can't be auto-approved, the scheduled session waits forever (see docs/agents.md). Build a small webhook handler for `session.status_idled` that texts or Discords you, or denies by rule. *Learn: event-driven agents, human-in-the-loop.*

5. **Build agent #3: the Watchdog** `mentee`
   Detects when the watcher stops posting, the feed breaks, or Twilio errors spike, and opens an incident issue. *Learn: designing an agent from scratch - tools, permissions, budget.*

6. **Build agent #4: the Code reviewer** `mentee`
   An agent that reviews every PR, including the maintainer's. *Learn: agents checking agents; when to trust their output.*

7. **Give the security guard a grader** `mentee`
   Switch its kickoff to an outcome with a rubric (see the Managed Agents "outcomes" docs) so a second pass checks its report before it files issues. *Learn: self-checking agents.*

## Make the service better

8. **Only text about Bronx stations** `agent-ok`
   A [6] delay at Astor Pl isn't Bronx news. Use GTFS static `stops.txt` to keep alerts whose `stop_id`s are in the Bronx (or that have no stops listed).

9. **Weekend planned-work digest** `mentee`
   Planned work is skipped today. Send one Friday-afternoon summary of the weekend's planned changes instead.

10. **Let riders sign up by text** `mentee`
    "BRONX" to subscribe, "ESPAÑOL" to switch language, STOP handled by Twilio. Needs an incoming-SMS webhook (verify Twilio's signature!) and somewhere to store subscribers.

11. **Pick your lines** `agent-ok`
    Subscribers choose lines (`+1718...:es:4,5`) so a D-train rider doesn't get [6] alerts.

12. **Keep texts to one or two segments** `agent-ok`
    Spanish accents force UCS-2 (70 chars per segment), so a 280-char Spanish text costs 4-5 segments. Add a test that warns above 2 segments, and tune the prompt length for Spanish.

13. **Quiet hours** `agent-ok`
    Don't text between 11 PM and 5 AM unless the alert is a suspension.

14. **Discord / web feed** `mentee`
    Your call.

15. **Deploy it** `mentee`
    Get the watcher running 24/7 (Railway or Fly.io, ~$5/month) with the state file on a persistent volume.
