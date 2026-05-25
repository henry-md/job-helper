Extension Ludicrous Mode default-on setting

- Symptom: the extension settings panel could show Ludicrous Mode as `Disabled` for profiles that had no intentional user choice, because the shared and extension defaults treated missing `ludicrousMode` as `false`.
- Fix: Ludicrous Mode is now default-on in shared profile parsing and extension summary parsing. Generation settings version 5 upgrades older saved defaults to on; explicit off choices saved at version 5 remain off.
- UI rule: behavior-changing Tailor Resume switches in the extension should look like switches, not just status pills. The active state should include both status text and a visible on-track/handle affordance.
