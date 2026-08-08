# Stable release evidence

Stable releases use two separate workflows:

1. **Build signed stable candidate** creates signed/notarized artifacts and a private draft GitHub Release.
2. **Publish verified stable release** publishes that draft only after the exact candidate artifacts pass physical and external QA.

After testing a candidate, copy `example.json` to `<version>.json`, for example `1.0.0.json`. Replace every placeholder with retained evidence and the real SHA-256 values from the draft release. Commit the completed file to `main`; do not move the release tag.

The publish workflow rejects the evidence unless all of these are true:

- the release tag and full commit match the candidate;
- the candidate workflow succeeded for that exact commit;
- the DMG, installer and portable executable hashes match the draft release;
- source and packaged smoke passed on explicitly selected displays whose exact identities are recorded;
- the signed Mac candidate passed clean install, Gatekeeper, multi-display and network-view checks;
- both signed Windows packages passed clean install/launch, firewall, multi-display and uninstall checks;
- at least one external operator completed the beta with zero open release blockers;
- public release, limitations, requirements and privacy documents were reviewed.

Evidence may be a repository path, issue/discussion URL or another durable record that contains the date, machine, procedure and result. Do not include customer data, local IP addresses, control tokens or signing secrets.

Validate locally after downloading the draft artifacts and its `SHA256SUMS.txt`:

```bash
node tools/verify-release-evidence.js release-evidence/1.0.0.json \
  --tag v1.0.0 \
  --commit FULL_40_CHARACTER_TAG_COMMIT \
  --checksums PATH/TO/SHA256SUMS.txt
```

An evidence file is a release gate, not a place to mark planned work as passed. Keep the example file intentionally invalid.
