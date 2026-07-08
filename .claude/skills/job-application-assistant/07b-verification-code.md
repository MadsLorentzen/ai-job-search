# Email verification-code gate (Greenhouse and similar)

Some portals gate **Submit** behind an emailed N-character verification code
("A verification code was sent to <email>. Enter the code to submit."). This is
an anti-bot check, not reCAPTCHA. The field is usually N per-character OTP boxes
(`#security-input-0..N-1`, maxlength 1).

Handle it in two steps once the account's Gmail is authorized (see the
multi-account Gmail connector: `ctl gmail authorize`, ArcsHealth/ctl):

## 1. Fetch the code (on dev — where @arcs/ctl lives)

```bash
ctl gmail fetch-code --account rooseveltadvisors@gmail.com \
  --from greenhouse --pattern '[A-Za-z0-9]{8}' --wait 120
```

- `--wait` polls up to N seconds, so click the portal's "send code" first, then run this.
- `--pattern` is the code shape (anchored on word boundaries automatically).
- Prints just the code (or JSON with `--format json`).

## 2. Enter it + submit (on the Chrome host — e.g. agt-2, where the real browser holds the form)

```bash
/tmp/cdpvenv/bin/python3 /opt/ra/ai-job-search/tools/enter-code.py --code <CODE>
```

`enter-code.py` native-sets each OTP box (so React's onChange fires), clicks
**Submit application**, waits, and prints `{url, ok, errs}` — `ok:true` means the
confirmation page rendered. Non-zero exit = code rejected or submit blocked.

## Orchestration (from the driving session, e.g. gpu)

```bash
CODE=$(ssh dev "ctl gmail fetch-code --account rooseveltadvisors@gmail.com --from greenhouse --pattern '[A-Za-z0-9]{8}' --wait 120")
ssh agt-2 "/tmp/cdpvenv/bin/python3 /opt/ra/ai-job-search/tools/enter-code.py --code $CODE"
```

## Notes

- The full form fill + PDF attach that precedes this runs on the real Chrome via
  CDP + steer (see the project memory: real-browser submit method). The code gate
  is the final step.
- If the code expired (they last ~10–15 min), re-trigger the portal's send and
  re-fetch.
